const OpenAI  = require('openai')
const logger  = require('../utils/logger')

/**
 * llm.service.js v4.0 — Azure OpenAI gateway (gpt-4o-mini)
 *
 * Single provider: Azure OpenAI via openai npm SDK with baseURL + apiKey.
 * On failure: silent 2-second retry once, then throw (caller sends natural msg).
 * No Groq, no Gemini, no fallback chain.
 */

// ─── AZURE OPENAI CLIENT ────────────────────────────────────────
const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY || ''
const DEPLOYMENT       = 'gpt-4o-mini'

if (!AZURE_OPENAI_KEY) {
  logger.error('AZURE_OPENAI_KEY not set — LLM calls will fail')
}

const client = new OpenAI({
  apiKey:  AZURE_OPENAI_KEY,
  baseURL: 'https://aykachatbot-resource.openai.azure.com/openai/deployments/gpt-4o-mini',
  defaultQuery:   { 'api-version': '2024-05-01-preview' },
  defaultHeaders: { 'api-key': AZURE_OPENAI_KEY },
})

logger.info({ deployment: DEPLOYMENT }, 'Azure OpenAI initialized (gpt-4o-mini)')

// ─── CONCURRENCY LIMITER ────────────────────────────────────────
const MAX_CONCURRENT = parseInt(process.env.LLM_MAX_CONCURRENCY) || 5
let activeCalls = 0
const waitQueue = []

function acquireSemaphore() {
  return new Promise(resolve => {
    if (activeCalls < MAX_CONCURRENT) { activeCalls++; return resolve() }
    waitQueue.push(resolve)
  })
}
function releaseSemaphore() {
  activeCalls--
  if (waitQueue.length > 0) { activeCalls++; waitQueue.shift()() }
}

// ─── STATS ──────────────────────────────────────────────────────
const llmStats = {
  totalCalls: 0,
  successes: 0,
  failures: 0,
  retries: 0,
  peakConcurrency: 0,
  resetAt: new Date(),
}

function getLLMStats() {
  return {
    ...llmStats,
    provider: 'azure-openai',
    deployment: DEPLOYMENT,
    concurrency: { current: activeCalls, max: MAX_CONCURRENT, peak: llmStats.peakConcurrency, queued: waitQueue.length },
  }
}

// ─── CORE AZURE CALL ────────────────────────────────────────────
async function _callAzure(systemPrompt, recentMessages) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentMessages.slice(-10).map(msg => ({
      role: msg.role === 'assistant' ? 'assistant' : 'user',
      content: msg.content?.text || msg.content || '',
    })),
  ]

  const response = await client.chat.completions.create({
    model: DEPLOYMENT,
    messages,
    max_tokens: 400,
    temperature: 0.7,
  })

  const content = response.choices?.[0]?.message?.content
  if (!content?.trim()) throw new Error('Azure OpenAI returned empty response')
  return content.trim()
}

// ─── UNIFIED CALL ───────────────────────────────────────────────
/**
 * callLLM(systemPrompt, recentMessages) → string
 *
 * Primary: Azure OpenAI gpt-4o-mini
 * On failure: silent 2s retry once, then throw.
 */
async function callLLM(systemPrompt, recentMessages) {
  llmStats.totalCalls++

  await acquireSemaphore()
  if (activeCalls > llmStats.peakConcurrency) llmStats.peakConcurrency = activeCalls

  try {
    // ── Attempt 1 ──
    try {
      const result = await _callAzure(systemPrompt, recentMessages)
      llmStats.successes++
      return result
    } catch (err) {
      logger.warn({ err: err.message, status: err.status }, 'Azure OpenAI first attempt failed — retrying in 2s')
      llmStats.retries++
    }

    // ── Silent retry after 2 seconds ──
    await new Promise(resolve => setTimeout(resolve, 2000))

    try {
      const result = await _callAzure(systemPrompt, recentMessages)
      llmStats.successes++
      return result
    } catch (err) {
      logger.error({ err: err.message, status: err.status }, 'Azure OpenAI retry also failed')
      llmStats.failures++
      throw err
    }
  } finally {
    releaseSemaphore()
  }
}

module.exports = { callLLM, getLLMStats }
