const OpenAI  = require('openai')
const logger  = require('../utils/logger')
const { callGroq } = require('./groq.service')

/**
 * llm.service.js v4.1 - Azure OpenAI gateway
 *
 * Primary provider: Azure OpenAI via chat-completions or responses endpoint.
 * Fallback provider: Groq when Azure retries are exhausted.
 */

// ─── AZURE OPENAI CLIENT ────────────────────────────────────────
const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY || ''
const DEPLOYMENT       = process.env.AZURE_OPENAI_DEPLOYMENT || 'gpt-4.1-mini'
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT || 'https://aykachatbot-resource.cognitiveservices.azure.com'
const AZURE_OPENAI_API_VERSION = process.env.AZURE_OPENAI_API_VERSION || '2024-05-01-preview'

/**
 * buildAzureOpenAIBaseUrl - Normalize endpoint/deployment into Azure Chat Completions base URL.
 * @param {string} endpoint - Azure OpenAI resource endpoint from env.
 * @param {string} deployment - Azure deployment name.
 * @returns {string} Base URL suitable for openai SDK client.
 */
function buildAzureOpenAIBaseUrl(endpoint, deployment) {
  const cleaned = String(endpoint || '').trim().replace(/\/+$/, '')
  if (cleaned.endsWith('/responses')) return cleaned.replace(/\/responses$/, '')
  if (cleaned.endsWith('/openai/v1')) return cleaned
  if (cleaned.includes('/openai/deployments/')) return cleaned
  return `${cleaned}/openai/deployments/${deployment}`
}

function isResponsesEndpoint(endpoint) {
  const cleaned = String(endpoint || '').trim().replace(/\/+$/, '')
  return cleaned.endsWith('/responses') || cleaned.endsWith('/openai/v1')
}

function buildResponsesUrl(endpoint) {
  const cleaned = String(endpoint || '').trim().replace(/\/+$/, '')
  if (cleaned.endsWith('/responses')) return cleaned
  if (cleaned.endsWith('/openai/v1')) return `${cleaned}/responses`
  return `${cleaned}/openai/v1/responses`
}

const AZURE_OPENAI_BASE_URL = buildAzureOpenAIBaseUrl(AZURE_OPENAI_ENDPOINT, DEPLOYMENT)
const USE_RESPONSES_API = String(process.env.AZURE_OPENAI_API_MODE || '').toLowerCase() === 'responses'
  || isResponsesEndpoint(AZURE_OPENAI_ENDPOINT)
const AZURE_RESPONSES_URL = buildResponsesUrl(AZURE_OPENAI_ENDPOINT)

if (!AZURE_OPENAI_KEY) {
  logger.error('AZURE_OPENAI_KEY not set - LLM calls will fail')
}

const client = new OpenAI({
  apiKey:  AZURE_OPENAI_KEY,
  baseURL: AZURE_OPENAI_BASE_URL,
  defaultQuery:   USE_RESPONSES_API ? undefined : { 'api-version': AZURE_OPENAI_API_VERSION },
  defaultHeaders: { 'api-key': AZURE_OPENAI_KEY },
})

logger.info({ deployment: DEPLOYMENT, apiMode: USE_RESPONSES_API ? 'responses' : 'chat-completions' }, 'Azure OpenAI initialized')

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
  fallbackAttempts: 0,
  fallbackSuccesses: 0,
  peakConcurrency: 0,
  resetAt: new Date(),
}

function getLLMStats() {
  return {
    ...llmStats,
    provider: 'azure-openai',
    fallbackProvider: 'groq',
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

  if (USE_RESPONSES_API) {
    return _callAzureResponses(messages)
  }

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

function extractResponsesText(response) {
  if (response?.output_text?.trim()) return response.output_text.trim()

  const textParts = []
  for (const item of response?.output || []) {
    for (const content of item?.content || []) {
      if (content?.type === 'output_text' && content?.text) textParts.push(content.text)
      if (content?.type === 'text' && content?.text) textParts.push(content.text)
    }
  }

  const text = textParts.join('\n').trim()
  if (!text) throw new Error('Azure OpenAI returned empty response')
  return text
}

async function _callAzureResponses(messages) {
  const response = await fetch(AZURE_RESPONSES_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'api-key': AZURE_OPENAI_KEY,
      Authorization: `Bearer ${AZURE_OPENAI_KEY}`,
    },
    body: JSON.stringify({
      model: DEPLOYMENT,
      input: messages.map(message => ({
        role: message.role,
        content: String(message.content || ''),
      })),
      max_output_tokens: 400,
      temperature: LLM_TEMPERATURE,
    }),
  })

  const data = await response.json().catch(() => ({}))
  if (!response.ok) {
    const message = data?.error?.message || data?.message || response.statusText
    const err = new Error(`${response.status} ${message}`)
    err.status = response.status
    throw err
  }

  return extractResponsesText(data)
}

// ─── UNIFIED CALL ───────────────────────────────────────────────
/**
 * callLLM(systemPrompt, recentMessages) → string
 *
 * Primary: Azure OpenAI gpt-4.1-mini
 * Fallback: Groq after Azure retries are exhausted.
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
          logger.warn({ err: err.message, status, attempt }, 'Azure OpenAI rate limited - retrying with backoff')
          continue
        }
        if (attempt < 3 && status !== 429) {
          logger.warn({ err: err.message, status, attempt }, 'Azure OpenAI call failed - retrying once')
          continue
        }
        logger.error({ err: err.message, status }, 'Azure OpenAI retries exhausted - trying Groq fallback')

        llmStats.fallbackAttempts++
        try {
          const fallbackResult = await callGroq(systemPrompt, recentMessages)
          llmStats.fallbackSuccesses++
          llmStats.successes++
          return fallbackResult
        } catch (fallbackErr) {
          logger.error({ err: fallbackErr?.message || fallbackErr }, 'Groq fallback failed')
          llmStats.failures++
          throw err
        }
      }
    }
  } finally {
    releaseSemaphore()
  }
}

module.exports = { callLLM, getLLMStats }
