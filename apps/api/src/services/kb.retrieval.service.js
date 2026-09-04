const crypto = require('crypto')
const { embedTexts } = require('./ai.gateway.service')
const logger = require('../utils/logger')

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
  return {
    id: stableHash(`${path}|${rendered}`),
    path,
    text: `${humanizePath(path)}: ${rendered}`.trim(),
  }
}

function flattenKnowledge(value, path = 'knowledge', chunks = [], depth = 0) {
  if (value == null || depth > 12) return chunks

  if (isPrimitive(value)) {
    const chunk = makeChunk(path, value)
    if (chunk) chunks.push(chunk)
    return chunks
  }

  if (Array.isArray(value)) {
    if (!value.length) return chunks
    const rendered = compactValue(value)
    if (value.every(isPrimitive) && rendered.length <= 900) {
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
  if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length || !a.length) return -1
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

  const embeddings = []
  for (let offset = 0; offset < chunks.length; offset += 64) {
    const batch = chunks.slice(offset, offset + 64)
    embeddings.push(...await embedTexts(batch.map(chunk => chunk.text)))
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

function addContext(query, request, targetClass) {
  const parts = [cleanQuery(query)]
  const entities = Array.isArray(request?.entities)
    ? request.entities.map(cleanQuery).filter(Boolean)
    : []
  if (entities.length) parts.push(`Relevant entities: ${entities.join(', ')}`)
  if (targetClass) parts.push(`Target admission class: ${targetClass}`)
  return parts.filter(Boolean).join('\n')
}

/**
 * Build one explicit semantic query group per parent information need. The
 * request itself is always the core query. Model-planned expansions are attached
 * by requestIndex, so extra/fewer expansions can never shift another request's
 * context positionally.
 */
function buildSemanticQueryGroups({ message, understanding, session }) {
  const requests = Array.isArray(understanding?.requests)
    ? understanding.requests.slice(0, 8)
    : []
  const expansions = Array.isArray(understanding?.retrievalQueries)
    ? understanding.retrievalQueries
    : []
  const targetClass = cleanQuery(session?.flowState?.collectedData?.interestedClass)

  if (!requests.length) {
    const raw = cleanQuery(message)
    return raw ? [{ requestIndex: -1, core: raw, variants: [raw] }] : []
  }

  return requests.map((request, requestIndex) => {
    const coreNeed = cleanQuery(request?.need) || cleanQuery(message)
    const core = addContext(coreNeed, request, targetClass)
    const variants = [core]

    for (const expansion of expansions) {
      if (Number(expansion?.requestIndex) !== requestIndex) continue
      const expanded = addContext(expansion?.query, request, targetClass)
      if (expanded) variants.push(expanded)
    }

    const unique = []
    const seen = new Set()
    for (const variant of variants) {
      const key = variant.toLowerCase()
      if (!variant || seen.has(key)) continue
      seen.add(key)
      unique.push(variant)
    }

    return { requestIndex, core, variants: unique.slice(0, 4) }
  }).filter(group => group.core)
}

function flattenQueryGroups(groups) {
  const texts = []
  const variantRefs = []
  groups.forEach((group, groupIndex) => {
    group.variants.forEach((text, variantIndex) => {
      texts.push(text)
      variantRefs.push({ groupIndex, variantIndex })
    })
  })
  return { texts, variantRefs }
}

/**
 * Score evidence against requests, not against a flat list of expansions. The
 * core request dominates. An expansion can improve a score, but can never drag
 * the core request toward a different semantic requirement.
 */
function scoreChunksAgainstGroups(chunks, groups, queryVectors, variantRefs) {
  return chunks.map(chunk => {
    const perGroupVariantScores = groups.map(group => new Array(group.variants.length).fill(-1))

    queryVectors.forEach((vector, vectorIndex) => {
      const ref = variantRefs[vectorIndex]
      if (!ref) return
      perGroupVariantScores[ref.groupIndex][ref.variantIndex] = cosineSimilarity(vector, chunk.embedding)
    })

    const groupScores = perGroupVariantScores.map(scores => {
      const coreScore = Number(scores[0])
      const expansionScores = scores.slice(1).filter(Number.isFinite)
      const bestExpansion = expansionScores.length ? Math.max(...expansionScores) : -1

      if (!Number.isFinite(coreScore)) return bestExpansion
      if (!Number.isFinite(bestExpansion) || bestExpansion <= coreScore) return coreScore

      // Core semantics remain dominant; expansions only provide a bounded lift.
      return (0.72 * coreScore) + (0.28 * bestExpansion)
    })

    return { ...chunk, groupScores, perGroupVariantScores }
  })
}

function selectEvidenceForGroups(scored, groups, {
  topK = 8,
  minimumScore = 0.18,
  maxChars = 6500,
  supportPerGroup = 0,
  supportGap = 0.06,
} = {}) {
  if (!Array.isArray(scored) || !scored.length || !Array.isArray(groups) || !groups.length) return []

  const selectedById = new Map()
  let usedChars = 0

  function addCandidate(candidate, groupIndex) {
    if (!candidate || candidate.score < minimumScore) return false

    const existing = selectedById.get(candidate.id)
    if (existing) {
      if (!existing.matchedGroupIndexes.includes(groupIndex)) existing.matchedGroupIndexes.push(groupIndex)
      return true
    }

    if (selectedById.size >= topK) return false
    if (usedChars + candidate.text.length > maxChars && selectedById.size > 0) return false

    selectedById.set(candidate.id, {
      ...candidate,
      matchedGroupIndexes: [groupIndex],
    })
    usedChars += candidate.text.length
    return true
  }

  for (let groupIndex = 0; groupIndex < groups.length; groupIndex += 1) {
    const ranked = scored
      .filter(candidate => Number.isFinite(candidate.groupScores?.[groupIndex]))
      .sort((a, b) => b.groupScores[groupIndex] - a.groupScores[groupIndex])

    const best = ranked[0]
    if (!best || best.groupScores[groupIndex] < minimumScore) continue

    addCandidate({ ...best, score: best.groupScores[groupIndex] }, groupIndex)

    if (supportPerGroup <= 0) continue
    const floor = Math.max(minimumScore, best.groupScores[groupIndex] - supportGap)
    let supportAdded = 0
    for (const candidate of ranked.slice(1)) {
      if (supportAdded >= supportPerGroup || selectedById.size >= topK) break
      const score = candidate.groupScores[groupIndex]
      if (!Number.isFinite(score) || score < floor) break
      if (addCandidate({ ...candidate, score }, groupIndex)) supportAdded += 1
    }
  }

  return [...selectedById.values()].sort((a, b) => b.score - a.score)
}

async function retrieveKnowledge({ kb, message, understanding, session }) {
  if (!kb?.content || !understanding?.requiresKnowledge) {
    return { evidenceText: '', sources: [], semantic: true, skipped: true, failed: false }
  }

  try {
    const index = await buildIndex(kb)
    if (!index.chunks.length) {
      return { evidenceText: '', sources: [], semantic: true, skipped: false, failed: false }
    }

    const queryGroups = buildSemanticQueryGroups({ message, understanding, session })
    if (!queryGroups.length) {
      return { evidenceText: '', sources: [], semantic: true, skipped: false, failed: false, queryGroups: [] }
    }

    const flattened = flattenQueryGroups(queryGroups)
    const queryVectors = await embedTexts(flattened.texts)
    const scored = scoreChunksAgainstGroups(index.chunks, queryGroups, queryVectors, flattened.variantRefs)

    const requestedTopK = Number.parseInt(process.env.KB_RETRIEVAL_TOP_K || '8', 10) || 8
    const topK = Math.min(14, Math.max(1, requestedTopK))
    const parsedMinimumScore = Number.parseFloat(process.env.KB_RETRIEVAL_MIN_SCORE || '0.18')
    const minimumScore = Number.isFinite(parsedMinimumScore) ? parsedMinimumScore : 0.18
    const maxChars = Math.max(1500, Number.parseInt(process.env.KB_RETRIEVAL_MAX_CHARS || '6500', 10) || 6500)
    const parsedSupport = Number.parseInt(process.env.KB_RETRIEVAL_SUPPORT_PER_QUERY || '0', 10)
    const supportPerGroup = Math.min(2, Math.max(0, Number.isFinite(parsedSupport) ? parsedSupport : 0))
    const parsedGap = Number.parseFloat(process.env.KB_RETRIEVAL_SUPPORT_GAP || '0.06')
    const supportGap = Number.isFinite(parsedGap) ? Math.min(0.2, Math.max(0, parsedGap)) : 0.06

    const selected = selectEvidenceForGroups(scored, queryGroups, {
      topK,
      minimumScore,
      maxChars,
      supportPerGroup,
      supportGap,
    })

    const evidenceText = selected.map((item, indexValue) => `[E${indexValue + 1}] ${item.text}`).join('\n')

    return {
      evidenceText,
      sources: selected.map((item, indexValue) => ({
        id: `E${indexValue + 1}`,
        path: item.path,
        score: Number(item.score.toFixed(4)),
        matchedRequestIndexes: item.matchedGroupIndexes.map(groupIndex => queryGroups[groupIndex]?.requestIndex),
        text: item.text,
      })),
      semantic: true,
      skipped: false,
      failed: false,
      queryGroups,
      queries: flattened.texts,
      query: flattened.texts.join('\n'),
    }
  } catch (error) {
    logger.error({ error: error?.message }, 'Semantic KB retrieval failed')
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
    buildSemanticQueryGroups,
    flattenQueryGroups,
    scoreChunksAgainstGroups,
    selectEvidenceForGroups,
  },
}
