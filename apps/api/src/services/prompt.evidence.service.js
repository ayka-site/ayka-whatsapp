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

  return normalized
    .split(/\n(?=•\s)/g)
    .map(value => value.replace(/^•\s*/, '').trim())
    .filter(Boolean)
    .map((value, index) => ({ id: `${prefix}-${index + 1}`, text: `${prefix}: ${value}` }))
}

/**
 * The legacy school prompt can contain both an authoritative structured
 * class-wise fee table and a derived "simple totals" representation. The
 * latter amortizes one-time/annual charges into an approximate monthly figure,
 * which is useful only for old KBs that lack structured fees. When structured
 * class-wise fees are present, keep them as the fee amount source of truth for
 * semantic retrieval while retaining separate frequency notes that explain
 * which charges are monthly, one-time or annual.
 */
function suppressShadowedLegacyFeeChunks(chunks) {
  const values = Array.isArray(chunks) ? chunks : []
  const hasStructuredClassWiseFees = values.some(chunk => {
    const text = String(chunk?.text || '')
    if (!/^KNOWN FACT:\s*Fees\s*\(/i.test(text)) return false
    if (/^KNOWN FACT:\s*Fees\s*\(SIMPLE TOTALS\b/i.test(text)) return false
    const heading = text.split('\n', 1)[0]
    return /\bclass-wise\b/i.test(heading)
  })

  if (!hasStructuredClassWiseFees) return values

  return values.filter(chunk => {
    const text = String(chunk?.text || '')
    return !/^KNOWN FACT:\s*Fees\s*\(SIMPLE TOTALS\b/i.test(text)
  })
}

/**
 * Compatibility bridge while the legacy prompt builder remains the envelope
 * between conversation.engine and the v3 receptionist. Only fact-bearing
 * sections are admitted as evidence; persona, sales rules and prompt policy are
 * never factual sources.
 */
function extractEvidenceChunks(systemPrompt) {
  const rawChunks = [
    ...splitFacts(extractSection(systemPrompt, 'KNOWN FACTS (say ONLY what is here - never invent)'), 'KNOWN FACT'),
    ...splitFacts(extractSection(systemPrompt, 'SPECIAL EVENT FACTS (use when asked about Talent Hunt / event / 28 March)'), 'SPECIAL EVENT'),
    ...splitFacts(extractSection(systemPrompt, 'HOSTEL FAQ (answer hostel questions from here FIRST)'), 'HOSTEL FAQ'),
    ...splitFacts(extractSection(systemPrompt, 'GENERAL PARENT FAQ (check here FIRST for ratio, computer, optional subjects, achievements, session, development, communication questions)'), 'GENERAL FAQ'),
  ]

  const chunks = suppressShadowedLegacyFeeChunks(rawChunks)
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
  for (let offset = 0; offset < chunks.length; offset += 64) {
    const batch = chunks.slice(offset, offset + 64)
    vectors.push(...await embedTexts(batch.map(chunk => chunk.text)))
  }

  const index = {
    key,
    chunks: chunks.map((chunk, indexValue) => ({ ...chunk, embedding: vectors[indexValue] })),
  }

  if (cache.size >= MAX_CACHE_ENTRIES) {
    const oldest = cache.keys().next().value
    if (oldest) cache.delete(oldest)
  }
  cache.set(key, index)
  return index
}

function buildPromptSemanticQueryGroups(message, understanding) {
  const groups = retrievalPrivate.buildSemanticQueryGroups({
    message,
    understanding,
    session: { flowState: { collectedData: {} } },
  })

  // A handoff is an action boundary, not semantic intent routing. When the
  // understanding layer explicitly requests one, ground contact information as
  // an independent action-support group.
  if (understanding?.shouldHandoff) {
    groups.push({
      requestIndex: -2,
      core: 'school staff contact information and contact hours',
      variants: ['school staff contact information and contact hours'],
      action: 'handoff',
    })
  }

  return groups.slice(0, 9)
}

async function retrievePromptEvidence({ systemPrompt, message, understanding }) {
  if (!understanding?.requiresKnowledge && !understanding?.shouldHandoff) {
    return { text: '', sources: [], failed: false, skipped: true, queryGroups: [] }
  }

  try {
    const index = await buildIndex(systemPrompt)
    if (!index.chunks.length) {
      return { text: '', sources: [], failed: false, skipped: false, queryGroups: [] }
    }

    const queryGroups = buildPromptSemanticQueryGroups(message, understanding)
    if (!queryGroups.length) {
      return { text: '', sources: [], failed: false, skipped: false, queryGroups: [] }
    }

    const flattened = retrievalPrivate.flattenQueryGroups(queryGroups)
    const vectors = await embedTexts(flattened.texts)
    const scored = retrievalPrivate.scoreChunksAgainstGroups(
      index.chunks,
      queryGroups,
      vectors,
      flattened.variantRefs,
    )

    const requestedTopK = Number.parseInt(process.env.KB_RETRIEVAL_TOP_K || '8', 10) || 8
    const topK = Math.min(14, Math.max(1, requestedTopK))
    const parsedMinimumScore = Number.parseFloat(process.env.KB_RETRIEVAL_MIN_SCORE || '0.18')
    const minimumScore = Number.isFinite(parsedMinimumScore) ? parsedMinimumScore : 0.18
    const maxChars = Math.max(1500, Number.parseInt(process.env.KB_RETRIEVAL_MAX_CHARS || '6500', 10) || 6500)
    const parsedSupport = Number.parseInt(process.env.KB_RETRIEVAL_SUPPORT_PER_QUERY || '0', 10)
    const supportPerGroup = Math.min(2, Math.max(0, Number.isFinite(parsedSupport) ? parsedSupport : 0))
    const parsedGap = Number.parseFloat(process.env.KB_RETRIEVAL_SUPPORT_GAP || '0.06')
    const supportGap = Number.isFinite(parsedGap) ? Math.min(0.2, Math.max(0, parsedGap)) : 0.06

    const selected = retrievalPrivate.selectEvidenceForGroups(scored, queryGroups, {
      topK,
      minimumScore,
      maxChars,
      supportPerGroup,
      supportGap,
    })

    return {
      text: selected.map((item, indexValue) => `[E${indexValue + 1}] ${item.text}`).join('\n'),
      sources: selected.map((item, indexValue) => ({
        id: `E${indexValue + 1}`,
        sourceId: item.id,
        score: Number(item.score.toFixed(4)),
        matchedRequestIndexes: item.matchedGroupIndexes.map(groupIndex => queryGroups[groupIndex]?.requestIndex),
        text: item.text,
      })),
      failed: false,
      skipped: false,
      queryGroups,
      queries: flattened.texts,
      query: flattened.texts.join('\n'),
    }
  } catch (error) {
    logger.error({ error: error?.message }, 'Prompt evidence retrieval failed')
    return { text: null, sources: [], failed: true, skipped: false, error: error?.message, queryGroups: [] }
  }
}

module.exports = {
  retrievePromptEvidence,
  extractPromptMetadata,
  extractEvidenceChunks,
  _private: {
    buildPromptSemanticQueryGroups,
    suppressShadowedLegacyFeeChunks,
  },
}
