const crypto = require('crypto')
const { embedTexts } = require('./ai.gateway.service')
const { _private: retrievalPrivate } = require('./kb.retrieval.service')
const logger = require('../utils/logger')

const cache = new Map()
const MAX_CACHE_ENTRIES = 20

function hash(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex').slice(0, 24)
}

function extractSection(prompt, heading, nextHeadingPattern = /\n━━━ /) {
  const text = String(prompt || '')
  const marker = `━━━ ${heading}`
  const start = text.indexOf(marker)
  if (start < 0) return ''

  const contentStart = text.indexOf('\n', start)
  if (contentStart < 0) return ''

  const rest = text.slice(contentStart + 1)
  const match = rest.match(nextHeadingPattern)
  const end = match?.index ?? rest.length
  return rest.slice(0, end).trim()
}

function splitFacts(section, prefix) {
  if (!section) return []

  const normalized = section.replace(/\r/g, '').trim()
  if (!normalized) return []

  if (prefix.includes('FAQ')) {
    return normalized
      .split(/\n---\n|(?=\n?Q:\s*)/g)
      .map(value => value.trim())
      .filter(value => value.length > 4)
      .map((value, index) => ({ id: `${prefix}-${index + 1}`, text: `${prefix}: ${value}` }))
  }

  // A fact bullet may span multiple lines (fees are the important example).
  const raw = normalized.split(/\n(?=•\s)/g)
  return raw
    .map(value => value.replace(/^•\s*/, '').trim())
    .filter(Boolean)
    .map((value, index) => ({ id: `${prefix}-${index + 1}`, text: `${prefix}: ${value}` }))
}

function extractEvidenceChunks(systemPrompt) {
  const chunks = [
    ...splitFacts(extractSection(systemPrompt, 'KNOWN FACTS (say ONLY what is here - never invent)'), 'KNOWN FACT'),
    ...splitFacts(extractSection(systemPrompt, 'SPECIAL EVENT FACTS (use when asked about Talent Hunt / event / 28 March)'), 'SPECIAL EVENT'),
    ...splitFacts(extractSection(systemPrompt, 'HOSTEL FAQ (answer hostel questions from here FIRST)'), 'HOSTEL FAQ'),
    ...splitFacts(extractSection(systemPrompt, 'GENERAL PARENT FAQ (check here FIRST for ratio, computer, optional subjects, achievements, session, development, communication questions)'), 'GENERAL FAQ'),
  ]

  const unique = []
  const seen = new Set()
  for (const chunk of chunks) {
    const key = chunk.text.toLowerCase().replace(/\s+/g, ' ')
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(chunk)
  }
  return unique
}

function extractPromptMetadata(systemPrompt) {
  const text = String(systemPrompt || '')
  const persona = text.match(/You are \*([^*]+)\*[^\n]*? at \*([^*]+)\*/i)
  const today = text.match(/^Today:\s*(.+)$/im)
  const memory = extractSection(text, 'MEMORY (ABSOLUTE TRUTH - NEVER CONTRADICT)')

  return {
    agentName: persona?.[1]?.trim() || 'Riya',
    organizationName: persona?.[2]?.trim() || 'the school',
    today: today?.[1]?.trim() || new Date().toLocaleString('en-IN', { timeZone: 'Asia/Kolkata' }),
    memory: memory || '(No structured memory available yet.)',
  }
}

async function buildIndex(systemPrompt) {
  const chunks = extractEvidenceChunks(systemPrompt)
  const key = hash(chunks.map(chunk => chunk.text).join('\n'))
  if (cache.has(key)) return cache.get(key)

  if (!chunks.length) return { key, chunks: [] }

  const vectors = []
  const batchSize = 64
  for (let offset = 0; offset < chunks.length; offset += batchSize) {
    const batch = chunks.slice(offset, offset + batchSize)
    vectors.push(...await embedTexts(batch.map(chunk => chunk.text)))
  }

  const index = {
    key,
    chunks: chunks.map((chunk, indexValue) => ({ ...chunk, vector: vectors[indexValue] })),
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const first = cache.keys().next().value
    if (first) cache.delete(first)
  }
  cache.set(key, index)
  return index
}

/**
 * The compatibility prompt path uses the same semantic coverage strategy as
 * the structured-KB retriever. We keep individual model-planned retrieval
 * queries separate rather than concatenating them into one broad query.
 *
 * Human handoff is an action boundary, not a semantic topic classification, so
 * when it is explicitly requested we add one deterministic contact-information
 * query to ensure the receptionist can ground staff contact details.
 */
function buildPromptSemanticQueries(message, understanding) {
  const queries = retrievalPrivate.buildSemanticQueries({
    message,
    understanding,
    session: { flowState: { collectedData: {} } },
  })

  if (understanding?.shouldHandoff) {
    queries.push('school staff contact information and contact hours')
  }

  return [...new Set(queries.map(value => String(value || '').trim()).filter(Boolean))].slice(0, 8)
}

async function retrievePromptEvidence({ systemPrompt, message, understanding }) {
  if (!understanding?.requiresKnowledge && !understanding?.shouldHandoff) {
    return { text: '', sources: [], failed: false, skipped: true }
  }

  try {
    const index = await buildIndex(systemPrompt)
    if (!index.chunks.length) return { text: '', sources: [], failed: false, skipped: false }

    const semanticQueries = buildPromptSemanticQueries(message, understanding)
    if (!semanticQueries.length) {
      return { text: '', sources: [], failed: false, skipped: false, queries: [], query: '' }
    }

    // Embed all information needs in one provider request. The KB index itself
    // is cached separately, so warm turns pay only for this small query batch.
    const queryVectors = await embedTexts(semanticQueries)
    const scoreableChunks = index.chunks.map(chunk => ({
      ...chunk,
      embedding: chunk.vector,
    }))
    const scored = retrievalPrivate.scoreChunksAgainstQueries(scoreableChunks, queryVectors)

    const requestedTopK = Number.parseInt(process.env.KB_RETRIEVAL_TOP_K || '8', 10) || 8
    const topK = Math.min(14, Math.max(1, requestedTopK))
    const parsedMinimumScore = Number.parseFloat(process.env.KB_RETRIEVAL_MIN_SCORE || '0.18')
    const minimumScore = Number.isFinite(parsedMinimumScore) ? parsedMinimumScore : 0.18
    const maxChars = Math.max(1500, Number.parseInt(process.env.KB_RETRIEVAL_MAX_CHARS || '6500', 10) || 6500)
    const parsedSupport = Number.parseInt(process.env.KB_RETRIEVAL_SUPPORT_PER_QUERY || '0', 10)
    const supportPerQuery = Math.min(2, Math.max(0, Number.isFinite(parsedSupport) ? parsedSupport : 0))
    const parsedGap = Number.parseFloat(process.env.KB_RETRIEVAL_SUPPORT_GAP || '0.06')
    const supportGap = Number.isFinite(parsedGap) ? Math.min(0.2, Math.max(0, parsedGap)) : 0.06

    const selected = retrievalPrivate.selectEvidenceForQueries(scored, semanticQueries.length, {
      topK,
      minimumScore,
      maxChars,
      supportPerQuery,
      supportGap,
    })

    return {
      text: selected.map((item, indexValue) => `[E${indexValue + 1}] ${item.text}`).join('\n'),
      sources: selected.map((item, indexValue) => ({
        id: `E${indexValue + 1}`,
        sourceId: item.id,
        score: Number(item.score.toFixed(4)),
        matchedQueries: item.matchedQueryIndexes.map(queryIndex => semanticQueries[queryIndex]),
        text: item.text,
      })),
      failed: false,
      skipped: false,
      queries: semanticQueries,
      query: semanticQueries.join('\n'),
    }
  } catch (error) {
    logger.error({ error: error?.message }, 'Prompt evidence retrieval failed')
    return { text: null, sources: [], failed: true, skipped: false, error: error?.message }
  }
}

module.exports = {
  retrievePromptEvidence,
  extractPromptMetadata,
  extractEvidenceChunks,
  _private: {
    buildPromptSemanticQueries,
  },
}
