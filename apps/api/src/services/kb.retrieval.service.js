const crypto = require('crypto')
const { embedTexts } = require('./ai.gateway.service')
const logger = require('../utils/logger')

/**
 * Semantic KB retrieval without hard-coded intent routing.
 *
 * The school KB is converted into small path-labelled evidence chunks. Chunk
 * embeddings are computed once per KB revision per process and reused. Each
 * parent turn embeds the semantic retrieval queries produced by the
 * understanding model in one batch, then retrieves evidence per information
 * need instead of filling a global top-K with loosely related chunks.
 */

const kbIndexCache = new Map()
const MAX_CACHE_ENTRIES = 20

function stableHash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 20)
}

function compactValue(value) {
  if (value == null) return ''
  if (typeof value === 'string') return value.replace(/\s+/g, ' ').trim()
  if (typeof value === 'number' || typeof value === 'boolean') return String(value)
  try {
    return JSON.stringify(value)
  } catch (_) {
    return String(value)
  }
}

function isPrimitive(value) {
  return value == null || ['string', 'number', 'boolean'].includes(typeof value)
}

function humanizePath(path) {
  return String(path || '')
    .replace(/\[(\d+)\]/g, ' item $1 ')
    .replace(/[._-]+/g, ' ')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ')
    .trim()
}

function makeChunk(path, value) {
  const rendered = compactValue(value)
  if (!rendered) return null
  const label = humanizePath(path)
  const text = `${label}: ${rendered}`.trim()
  return {
    id: stableHash(`${path}|${rendered}`),
    path,
    text,
  }
}

/**
 * Recursively produce compact evidence chunks. Small objects remain together
 * so related values (for example tuition + annual + additional fee for a class)
 * cannot be split across unrelated retrieval results.
 */
function flattenKnowledge(value, path = 'knowledge', chunks = [], depth = 0) {
  if (value == null || depth > 12) return chunks

  if (isPrimitive(value)) {
    const chunk = makeChunk(path, value)
    if (chunk) chunks.push(chunk)
    return chunks
  }

  if (Array.isArray(value)) {
    if (value.length === 0) return chunks

    const rendered = compactValue(value)
    const allPrimitive = value.every(isPrimitive)
    if (allPrimitive && rendered.length <= 900) {
      const chunk = makeChunk(path, value)
      if (chunk) chunks.push(chunk)
      return chunks
    }

    value.forEach((item, index) => {
      const itemPath = `${path}[${index}]`
      const itemRendered = compactValue(item)
      if (item && typeof item === 'object' && itemRendered.length <= 900) {
        const chunk = makeChunk(itemPath, item)
        if (chunk) chunks.push(chunk)
      } else {
        flattenKnowledge(item, itemPath, chunks, depth + 1)
      }
    })
    return chunks
  }

  const rendered = compactValue(value)
  const keys = Object.keys(value)
  if (depth >= 2 && rendered.length <= 900 && keys.length <= 14) {
    const chunk = makeChunk(path, value)
    if (chunk) chunks.push(chunk)
    return chunks
  }

  for (const [key, child] of Object.entries(value)) {
    flattenKnowledge(child, `${path}.${key}`, chunks, depth + 1)
  }
  return chunks
}

function dedupeChunks(chunks) {
  const seen = new Set()
  return chunks.filter(chunk => {
    if (!chunk?.text || seen.has(chunk.text)) return false
    seen.add(chunk.text)
    return true
  })
}

function kbRevision(kb) {
  const id = String(kb?._id || 'unknown')
  const version = String(kb?.version || '')
  const updatedAt = String(kb?.updatedAt || '')
  const contentHash = stableHash(JSON.stringify(kb?.content || {}))
  return `${id}:${version}:${updatedAt}:${contentHash}`
}

function cosineSimilarity(a, b) {
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || a.length === 0) return -1

  let dot = 0
  let aa = 0
  let bb = 0
  for (let i = 0; i < a.length; i += 1) {
    const av = Number(a[i] || 0)
    const bv = Number(b[i] || 0)
    dot += av * bv
    aa += av * av
    bb += bv * bv
  }
  if (!aa || !bb) return -1
  return dot / (Math.sqrt(aa) * Math.sqrt(bb))
}

async function buildIndex(kb) {
  const revision = kbRevision(kb)
  const cached = kbIndexCache.get(revision)
  if (cached) return cached

  const chunks = dedupeChunks(flattenKnowledge(kb?.content || {}, 'school'))
    .filter(chunk => chunk.text.length >= 3)
    .slice(0, 400)

  if (!chunks.length) {
    const empty = { revision, chunks: [] }
    kbIndexCache.set(revision, empty)
    return empty
  }

  // Batch embeddings to avoid oversized provider requests.
  const batchSize = 64
  const embeddings = []
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize)
    const vectors = await embedTexts(batch.map(chunk => chunk.text))
    embeddings.push(...vectors)
  }

  const indexed = {
    revision,
    chunks: chunks.map((chunk, index) => ({ ...chunk, embedding: embeddings[index] })),
  }

  if (kbIndexCache.size >= MAX_CACHE_ENTRIES) {
    const oldestKey = kbIndexCache.keys().next().value
    if (oldestKey) kbIndexCache.delete(oldestKey)
  }
  kbIndexCache.set(revision, indexed)
  return indexed
}

function cleanQuery(value) {
  return String(value || '').replace(/\s+/g, ' ').trim()
}

/**
 * Build one semantic query slot per information need. The understanding model's
 * retrievalQueries are useful semantic expansions, but they are not allowed to
 * reduce coverage: if it emits fewer queries than requests, the corresponding
 * request.need becomes the fallback query for each missing slot.
 *
 * This is structural coverage, not topic routing. The backend never inspects
 * words such as fees/hostel/transport to decide meaning.
 */
function buildSemanticQueries({ message, understanding, session }) {
  const explicitQueries = (understanding?.retrievalQueries || [])
    .map(cleanQuery)
    .filter(Boolean)
    .slice(0, 8)

  const requests = Array.isArray(understanding?.requests)
    ? understanding.requests.slice(0, 8)
    : []

  const slotCount = Math.min(8, Math.max(explicitQueries.length, requests.length))
  const bases = []

  for (let index = 0; index < slotCount; index += 1) {
    const explicit = explicitQueries[index]
    const requestNeed = cleanQuery(requests[index]?.need)
    const base = explicit || requestNeed
    if (base) bases.push({ base, requestIndex: index })
  }

  if (!bases.length) {
    const raw = cleanQuery(message)
    if (raw) bases.push({ base: raw, requestIndex: -1 })
  }

  const memory = session?.flowState?.collectedData || {}
  const targetClass = cleanQuery(memory.interestedClass)

  return bases.map(({ base, requestIndex }) => {
    const parts = [base]
    const request = requestIndex >= 0 ? requests[requestIndex] : null
    const entities = Array.isArray(request?.entities)
      ? request.entities.map(cleanQuery).filter(Boolean)
      : []

    if (entities.length) parts.push(`Relevant entities: ${entities.join(', ')}`)
    if (targetClass) parts.push(`Target admission class: ${targetClass}`)
    return parts.join('\n')
  }).slice(0, 8)
}

function scoreChunksAgainstQueries(chunks, queryVectors) {
  return chunks.map(chunk => {
    const queryScores = queryVectors.map(vector => cosineSimilarity(vector, chunk.embedding))
    const finiteScores = queryScores.filter(Number.isFinite)
    const score = finiteScores.length ? Math.max(...finiteScores) : -1
    return { ...chunk, queryScores, score }
  })
}

/**
 * Select coverage, not filler. By default we take the strongest evidence chunk
 * for each semantic query and stop. We never pad the result merely to reach
 * top-K, because unrelated but vaguely school-like chunks increase generation
 * risk. Optional support-per-query can be enabled later after evaluation.
 */
function selectEvidenceForQueries(scored, queryCount, {
  topK = 8,
  minimumScore = 0.18,
  maxChars = 6500,
  supportPerQuery = 0,
  supportGap = 0.06,
} = {}) {
  if (!Array.isArray(scored) || !scored.length || queryCount <= 0) return []

  const selectedById = new Map()
  let usedChars = 0

  function addCandidate(candidate, queryIndex) {
    if (!candidate || candidate.score < minimumScore) return false

    const existing = selectedById.get(candidate.id)
    if (existing) {
      if (!existing.matchedQueryIndexes.includes(queryIndex)) {
        existing.matchedQueryIndexes.push(queryIndex)
      }
      return true
    }

    if (selectedById.size >= topK) return false
    if (usedChars + candidate.text.length > maxChars && selectedById.size > 0) return false

    const row = {
      ...candidate,
      matchedQueryIndexes: [queryIndex],
    }
    selectedById.set(candidate.id, row)
    usedChars += candidate.text.length
    return true
  }

  for (let queryIndex = 0; queryIndex < queryCount; queryIndex += 1) {
    const ranked = scored
      .filter(candidate => Number.isFinite(candidate.queryScores?.[queryIndex]))
      .sort((a, b) => b.queryScores[queryIndex] - a.queryScores[queryIndex])

    const best = ranked[0]
    if (!best || best.queryScores[queryIndex] < minimumScore) continue

    const coverageCandidate = {
      ...best,
      score: best.queryScores[queryIndex],
    }
    addCandidate(coverageCandidate, queryIndex)

    if (supportPerQuery <= 0) continue

    const floor = Math.max(minimumScore, best.queryScores[queryIndex] - supportGap)
    let supportAdded = 0
    for (const candidate of ranked.slice(1)) {
      if (supportAdded >= supportPerQuery || selectedById.size >= topK) break
      const queryScore = candidate.queryScores[queryIndex]
      if (!Number.isFinite(queryScore) || queryScore < floor) break
      if (addCandidate({ ...candidate, score: queryScore }, queryIndex)) supportAdded += 1
    }
  }

  return [...selectedById.values()].sort((a, b) => b.score - a.score)
}

/**
 * Retrieve only evidence relevant to the current parent turn.
 *
 * If semantic retrieval is unavailable, this returns failed=true. The caller is
 * expected to fall back to the legacy full-KB prompt rather than guess.
 */
async function retrieveKnowledge({ kb, message, understanding, session }) {
  if (!kb?.content || !understanding?.requiresKnowledge) {
    return {
      evidenceText: '',
      sources: [],
      semantic: true,
      skipped: true,
      failed: false,
    }
  }

  try {
    const index = await buildIndex(kb)
    if (!index.chunks.length) {
      return { evidenceText: '', sources: [], semantic: true, skipped: false, failed: false }
    }

    const semanticQueries = buildSemanticQueries({ message, understanding, session })
    if (!semanticQueries.length) {
      return { evidenceText: '', sources: [], semantic: true, skipped: false, failed: false, queries: [] }
    }

    // All need-specific query embeddings are sent in one provider request.
    const queryVectors = await embedTexts(semanticQueries)
    const scored = scoreChunksAgainstQueries(index.chunks, queryVectors)

    const requestedTopK = Number.parseInt(process.env.KB_RETRIEVAL_TOP_K || '8', 10) || 8
    const topK = Math.min(14, Math.max(1, requestedTopK))
    const parsedMinimumScore = Number.parseFloat(process.env.KB_RETRIEVAL_MIN_SCORE || '0.18')
    const minimumScore = Number.isFinite(parsedMinimumScore) ? parsedMinimumScore : 0.18
    const maxChars = Math.max(1500, Number.parseInt(process.env.KB_RETRIEVAL_MAX_CHARS || '6500', 10) || 6500)
    const parsedSupport = Number.parseInt(process.env.KB_RETRIEVAL_SUPPORT_PER_QUERY || '0', 10)
    const supportPerQuery = Math.min(2, Math.max(0, Number.isFinite(parsedSupport) ? parsedSupport : 0))
    const parsedGap = Number.parseFloat(process.env.KB_RETRIEVAL_SUPPORT_GAP || '0.06')
    const supportGap = Number.isFinite(parsedGap) ? Math.min(0.2, Math.max(0, parsedGap)) : 0.06

    const selected = selectEvidenceForQueries(scored, semanticQueries.length, {
      topK,
      minimumScore,
      maxChars,
      supportPerQuery,
      supportGap,
    })

    const evidenceText = selected.length
      ? selected.map((item, index) => `[E${index + 1}] ${item.text}`).join('\n')
      : ''

    return {
      evidenceText,
      sources: selected.map((item, index) => ({
        id: `E${index + 1}`,
        path: item.path,
        score: Number(item.score.toFixed(4)),
        matchedQueries: item.matchedQueryIndexes.map(queryIndex => semanticQueries[queryIndex]),
        text: item.text,
      })),
      semantic: true,
      skipped: false,
      failed: false,
      queries: semanticQueries,
      query: semanticQueries.join('\n'),
    }
  } catch (error) {
    logger.error({ error: error?.message }, 'Semantic KB retrieval failed; caller should use safe full-KB fallback')
    return {
      evidenceText: null,
      sources: [],
      semantic: false,
      skipped: false,
      failed: true,
      error: error?.message,
    }
  }
}

function clearKnowledgeIndexCache() {
  kbIndexCache.clear()
}

module.exports = {
  retrieveKnowledge,
  clearKnowledgeIndexCache,
  _private: {
    flattenKnowledge,
    cosineSimilarity,
    buildSemanticQueries,
    scoreChunksAgainstQueries,
    selectEvidenceForQueries,
  },
}
