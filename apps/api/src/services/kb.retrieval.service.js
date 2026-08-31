const crypto = require('crypto')
const { embedTexts } = require('./ai.gateway.service')
const logger = require('../utils/logger')

/**
 * Semantic KB retrieval without hard-coded intent routing.
 *
 * The school KB is converted into small path-labelled evidence chunks. Chunk
 * embeddings are computed once per KB revision per process and reused. Each
 * parent turn embeds only the semantic query produced by the understanding
 * model, then retrieves the closest verified KB chunks.
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

function buildSemanticQuery({ message, understanding, session }) {
  const parts = [String(message || '').trim()]

  for (const query of understanding?.retrievalQueries || []) {
    if (query) parts.push(String(query).trim())
  }

  for (const request of understanding?.requests || []) {
    if (request?.need) parts.push(String(request.need).trim())
    if (Array.isArray(request?.entities) && request.entities.length) {
      parts.push(request.entities.join(' '))
    }
  }

  const memory = session?.flowState?.collectedData || {}
  if (memory.interestedClass) parts.push(`Target admission class: ${memory.interestedClass}`)

  return [...new Set(parts.filter(Boolean))].join('\n')
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

    const semanticQuery = buildSemanticQuery({ message, understanding, session })
    const [queryVector] = await embedTexts([semanticQuery])

    const scored = index.chunks
      .map(chunk => ({
        ...chunk,
        score: cosineSimilarity(queryVector, chunk.embedding),
      }))
      .filter(item => Number.isFinite(item.score))
      .sort((a, b) => b.score - a.score)

    const requestedTopK = Number.parseInt(process.env.KB_RETRIEVAL_TOP_K || '8', 10) || 8
    const topK = Math.min(14, Math.max(4, requestedTopK))
    const minimumScore = Number.parseFloat(process.env.KB_RETRIEVAL_MIN_SCORE || '0.18')
    const maxChars = Math.max(1500, Number.parseInt(process.env.KB_RETRIEVAL_MAX_CHARS || '6500', 10) || 6500)

    const selected = []
    let usedChars = 0
    for (const candidate of scored) {
      if (selected.length >= topK) break
      if (Number.isFinite(minimumScore) && candidate.score < minimumScore && selected.length >= 3) break
      if (usedChars + candidate.text.length > maxChars && selected.length >= 3) break
      selected.push(candidate)
      usedChars += candidate.text.length
    }

    const evidenceText = selected.length
      ? selected.map((item, index) => `[E${index + 1}] ${item.text}`).join('\n')
      : ''

    return {
      evidenceText,
      sources: selected.map((item, index) => ({
        id: `E${index + 1}`,
        path: item.path,
        score: Number(item.score.toFixed(4)),
        text: item.text,
      })),
      semantic: true,
      skipped: false,
      failed: false,
      query: semanticQuery,
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
    buildSemanticQuery,
  },
}
