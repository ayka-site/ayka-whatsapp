const crypto = require('crypto')
const { embedTexts } = require('./ai.gateway.service')
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

function cosine(a, b) {
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
  return aa && bb ? dot / (Math.sqrt(aa) * Math.sqrt(bb)) : -1
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

function buildQuery(message, understanding) {
  const parts = [String(message || '').trim()]
  for (const request of understanding?.requests || []) {
    if (request?.need) parts.push(request.need)
    for (const entity of request?.entities || []) parts.push(entity)
  }
  for (const query of understanding?.retrievalQueries || []) parts.push(query)

  if (understanding?.shouldHandoff) {
    parts.push('admissions staff contact phone working hours human handoff')
  }

  return [...new Set(parts.map(value => String(value || '').trim()).filter(Boolean))].join('\n')
}

async function retrievePromptEvidence({ systemPrompt, message, understanding }) {
  if (!understanding?.requiresKnowledge && !understanding?.shouldHandoff) {
    return { text: '', sources: [], failed: false, skipped: true }
  }

  try {
    const index = await buildIndex(systemPrompt)
    if (!index.chunks.length) return { text: '', sources: [], failed: false, skipped: false }

    const query = buildQuery(message, understanding)
    const [queryVector] = await embedTexts([query])
    const ranked = index.chunks
      .map(chunk => ({ ...chunk, score: cosine(queryVector, chunk.vector) }))
      .sort((a, b) => b.score - a.score)

    const topK = Math.min(14, Math.max(4, Number.parseInt(process.env.KB_RETRIEVAL_TOP_K || '8', 10) || 8))
    const maxChars = Math.max(1800, Number.parseInt(process.env.KB_RETRIEVAL_MAX_CHARS || '6500', 10) || 6500)
    const minScore = Number.parseFloat(process.env.KB_RETRIEVAL_MIN_SCORE || '0.18')

    const selected = []
    let chars = 0
    for (const item of ranked) {
      if (selected.length >= topK) break
      if (Number.isFinite(minScore) && item.score < minScore && selected.length >= 3) break
      if (chars + item.text.length > maxChars && selected.length >= 3) break
      selected.push(item)
      chars += item.text.length
    }

    return {
      text: selected.map((item, indexValue) => `[E${indexValue + 1}] ${item.text}`).join('\n'),
      sources: selected.map((item, indexValue) => ({
        id: `E${indexValue + 1}`,
        sourceId: item.id,
        score: Number(item.score.toFixed(4)),
        text: item.text,
      })),
      failed: false,
      skipped: false,
      query,
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
}
