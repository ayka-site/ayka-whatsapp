const OpenAI  = require('openai')
const logger  = require('../utils/logger')

/**
 * llm.service.js v4.0 — Azure OpenAI gateway (gpt-4o-mini)
 *
 * Single provider: Azure OpenAI via openai npm SDK with baseURL + apiKey.
 * On failure: retries with capped backoff, then throws (caller sends natural msg).
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
const MAX_CONTEXT_TOKENS = parseInt(process.env.LLM_MAX_CONTEXT_TOKENS || '6000', 10)
// Balanced default for natural yet fact-grounded admissions responses.
const configuredTemperature = Number.parseFloat(process.env.LLM_TEMPERATURE || '0.68')
const LLM_TEMPERATURE = Number.isFinite(configuredTemperature)
  ? Math.min(Math.max(configuredTemperature, 0), 1.2)
  : 0.68
let activeCalls = 0
const waitQueue = []

logger.info({ temperature: LLM_TEMPERATURE }, 'Azure OpenAI response temperature configured')

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

/**
 * estimateTokens - Rough token estimate used for pre-send context trimming.
 * @param {string} text - Text to estimate.
 * @returns {number} Approximate token count.
 */
function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4)
}

/**
 * trimRecentMessagesToTokenBudget - Keep newest turns while staying under token budget.
 * @param {Array<{role:string,content:any}>} recentMessages - Message history.
 * @param {number} budgetTokens - Max tokens for non-system history.
 * @returns {Array<{role:string,content:string}>} Trimmed messages in chronological order.
 */
function trimRecentMessagesToTokenBudget(recentMessages, budgetTokens) {
  const normalized = (recentMessages || []).map(msg => ({
    role: msg.role === 'assistant' ? 'assistant' : 'user',
    content: msg.content?.text || msg.content || '',
  }))

  let total = normalized.reduce((sum, msg) => sum + estimateTokens(msg.content), 0)
  while (normalized.length > 1 && total > budgetTokens) {
    const removed = normalized.shift()
    total -= estimateTokens(removed.content)
  }
  return normalized
}

// ─── CORE AZURE CALL ────────────────────────────────────────────
async function _callAzure(systemPrompt, recentMessages) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...trimRecentMessagesToTokenBudget(recentMessages.slice(-20), MAX_CONTEXT_TOKENS),
  ]

  const response = await client.chat.completions.create({
    model: DEPLOYMENT,
    messages,
    max_tokens: 400,
    temperature: LLM_TEMPERATURE,
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
 * On failure: retries up to 3 attempts (1s/2s/4s backoff for 429), then throws.
 */
async function callLLM(systemPrompt, recentMessages) {
  llmStats.totalCalls++

  await acquireSemaphore()
  if (activeCalls > llmStats.peakConcurrency) llmStats.peakConcurrency = activeCalls

  try {
    for (let attempt = 1; attempt <= 3; attempt++) {
      try {
        if (attempt > 1) llmStats.retries++
        if (attempt > 1) {
          const delayMs = Math.pow(2, attempt - 2) * 1000 // 1s, 2s, 4s
          await new Promise(resolve => setTimeout(resolve, delayMs))
        }

        const result = await _callAzure(systemPrompt, recentMessages)
        llmStats.successes++
        return result
      } catch (err) {
        const status = err?.status || err?.response?.status
        if (status === 429 && attempt < 3) {
          logger.warn({ err: err.message, status, attempt }, 'Azure OpenAI rate limited — retrying with backoff')
          continue
        }
        if (attempt < 3 && status !== 429) {
          logger.warn({ err: err.message, status, attempt }, 'Azure OpenAI call failed — retrying once')
          continue
        }
        logger.error({ err: err.message, status }, 'Azure OpenAI retries exhausted')
        llmStats.failures++
        throw err
      }
    }
  } finally {
    releaseSemaphore()
  }
}

module.exports = { callLLM, getLLMStats }
