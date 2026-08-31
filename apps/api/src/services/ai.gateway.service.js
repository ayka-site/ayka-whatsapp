const OpenAI = require('openai')
const logger = require('../utils/logger')

/**
 * Provider-neutral OpenAI-compatible AI gateway.
 *
 * Production default is OpenRouter because it gives us one API surface for
 * OpenAI, Google, Groq/open-source models, embeddings, provider failover and
 * privacy routing. Direct OpenAI or another compatible endpoint can be used
 * by changing environment variables only.
 *
 * IMPORTANT: no API keys or provider credentials belong in source control.
 */

function parseBoolean(value, fallback = false) {
  if (value == null || value === '') return fallback
  return ['1', 'true', 'yes', 'on'].includes(String(value).toLowerCase())
}

function parseList(value) {
  return String(value || '')
    .split(',')
    .map(item => item.trim())
    .filter(Boolean)
}

const PROVIDER = String(process.env.LLM_PROVIDER || 'openrouter').trim().toLowerCase()

function resolveApiKey() {
  if (process.env.LLM_API_KEY) return process.env.LLM_API_KEY
  if (PROVIDER === 'openrouter') return process.env.OPENROUTER_API_KEY || ''
  if (PROVIDER === 'openai') return process.env.OPENAI_API_KEY || ''
  return process.env.OPENROUTER_API_KEY || process.env.OPENAI_API_KEY || ''
}

function resolveBaseUrl() {
  if (process.env.LLM_BASE_URL) return process.env.LLM_BASE_URL.replace(/\/+$/, '')
  if (PROVIDER === 'openrouter') return 'https://openrouter.ai/api/v1'
  if (PROVIDER === 'openai') return 'https://api.openai.com/v1'
  return 'https://openrouter.ai/api/v1'
}

const API_KEY = resolveApiKey()
const BASE_URL = resolveBaseUrl()
const DEFAULT_MODEL = process.env.LLM_RESPONSE_MODEL || process.env.LLM_MODEL || (
  PROVIDER === 'openrouter' ? 'openai/gpt-5.6-luna' : 'gpt-5.6-luna'
)
const UNDERSTANDING_MODEL = process.env.LLM_UNDERSTANDING_MODEL || DEFAULT_MODEL
const VALIDATION_MODEL = process.env.LLM_VALIDATION_MODEL || DEFAULT_MODEL
const EMBEDDING_MODEL = process.env.LLM_EMBEDDING_MODEL || (
  PROVIDER === 'openrouter' ? 'openai/text-embedding-3-small' : 'text-embedding-3-small'
)
const FALLBACK_MODELS = parseList(process.env.LLM_FALLBACK_MODELS)

const MAX_CONCURRENT = Math.max(1, Number.parseInt(process.env.LLM_MAX_CONCURRENCY || '5', 10) || 5)
const REQUEST_TIMEOUT_MS = Math.max(5000, Number.parseInt(process.env.LLM_REQUEST_TIMEOUT_MS || '30000', 10) || 30000)
const parsedMaxRetries = Number.parseInt(process.env.LLM_MAX_RETRIES ?? '2', 10)
const MAX_RETRIES = Math.min(3, Math.max(0, Number.isNaN(parsedMaxRetries) ? 2 : parsedMaxRetries))
const SEND_TEMPERATURE = parseBoolean(process.env.LLM_SEND_TEMPERATURE, false)
const REASONING_EFFORT = String(process.env.LLM_REASONING_EFFORT || 'minimal').trim().toLowerCase()
const ALLOWED_REASONING_EFFORTS = new Set(['none', 'minimal', 'low', 'medium', 'high', 'xhigh'])

const defaultHeaders = {}
if (PROVIDER === 'openrouter') {
  if (process.env.OPENROUTER_SITE_URL) defaultHeaders['HTTP-Referer'] = process.env.OPENROUTER_SITE_URL
  defaultHeaders['X-Title'] = process.env.OPENROUTER_APP_NAME || 'AyKa AI Receptionist'
}

const client = new OpenAI({
  apiKey: API_KEY || 'missing-key',
  baseURL: BASE_URL,
  defaultHeaders,
  timeout: REQUEST_TIMEOUT_MS,
})

let activeCalls = 0
const waitQueue = []

function acquireSemaphore() {
  return new Promise(resolve => {
    if (activeCalls < MAX_CONCURRENT) {
      activeCalls += 1
      resolve()
      return
    }
    waitQueue.push(resolve)
  })
}

function releaseSemaphore() {
  activeCalls = Math.max(0, activeCalls - 1)
  if (waitQueue.length > 0) {
    activeCalls += 1
    const next = waitQueue.shift()
    next()
  }
}

const stats = {
  totalCalls: 0,
  successes: 0,
  failures: 0,
  retries: 0,
  structuredCalls: 0,
  embeddingCalls: 0,
  promptTokens: 0,
  completionTokens: 0,
  cachedTokens: 0,
  reasoningTokens: 0,
  cost: 0,
  upstreamInferenceCost: 0,
  modelUsage: {},
  peakConcurrency: 0,
  resetAt: new Date(),
}

function recordUsage(response) {
  const usage = response?.usage || {}
  const prompt = Number(usage.prompt_tokens || usage.input_tokens || usage.total_tokens || 0)
  const completion = Number(usage.completion_tokens || usage.output_tokens || 0)
  const cached = Number(
    usage.prompt_tokens_details?.cached_tokens ||
    usage.input_tokens_details?.cached_tokens ||
    0
  )
  const reasoning = Number(
    usage.completion_tokens_details?.reasoning_tokens ||
    usage.output_tokens_details?.reasoning_tokens ||
    0
  )
  const cost = Number(usage.cost || 0)
  const upstreamInferenceCost = Number(usage.cost_details?.upstream_inference_cost || 0)

  stats.promptTokens += Number.isFinite(prompt) ? prompt : 0
  stats.completionTokens += Number.isFinite(completion) ? completion : 0
  stats.cachedTokens += Number.isFinite(cached) ? cached : 0
  stats.reasoningTokens += Number.isFinite(reasoning) ? reasoning : 0
  stats.cost += Number.isFinite(cost) ? cost : 0
  stats.upstreamInferenceCost += Number.isFinite(upstreamInferenceCost) ? upstreamInferenceCost : 0

  const model = response?.model || 'unknown'
  stats.modelUsage[model] = (stats.modelUsage[model] || 0) + 1
}

function getGatewayStats() {
  return {
    ...stats,
    provider: PROVIDER,
    baseUrl: BASE_URL,
    responseModel: DEFAULT_MODEL,
    understandingModel: UNDERSTANDING_MODEL,
    validationModel: VALIDATION_MODEL,
    embeddingModel: EMBEDDING_MODEL,
    fallbackModels: FALLBACK_MODELS,
    reasoningEffort: REASONING_EFFORT,
    concurrency: {
      current: activeCalls,
      max: MAX_CONCURRENT,
      peak: stats.peakConcurrency,
      queued: waitQueue.length,
    },
  }
}

function getProviderRouting() {
  if (PROVIDER !== 'openrouter') return undefined

  const routing = {
    allow_fallbacks: parseBoolean(process.env.OPENROUTER_ALLOW_PROVIDER_FALLBACKS, true),
    data_collection: process.env.OPENROUTER_DATA_COLLECTION || 'deny',
    // Keep this false by default. When true, OpenRouter rejects any provider
    // endpoint that does not advertise support for every request parameter.
    // That is useful for tightly pinned production routes, but it is too strict
    // for heterogeneous/free-model routing where OpenRouter can otherwise
    // normalize or ignore unsupported optional parameters safely.
    require_parameters: parseBoolean(process.env.OPENROUTER_REQUIRE_PARAMETERS, false),
  }

  const sort = String(process.env.OPENROUTER_PROVIDER_SORT || '').trim()
  if (sort) routing.sort = sort

  const only = parseList(process.env.OPENROUTER_PROVIDER_ONLY)
  if (only.length) routing.only = only

  const ignore = parseList(process.env.OPENROUTER_PROVIDER_IGNORE)
  if (ignore.length) routing.ignore = ignore

  // ZDR is intentionally opt-in. Some otherwise suitable providers are not
  // available under ZDR. Enable after confirming the selected model has a
  // compatible provider route for production.
  if (parseBoolean(process.env.OPENROUTER_ZDR, false)) routing.zdr = true

  return routing
}

function buildOpenRouterExtras(model, fallbacks = FALLBACK_MODELS) {
  if (PROVIDER !== 'openrouter') return {}

  const body = {}
  const cleanFallbacks = (fallbacks || []).filter(candidate => candidate && candidate !== model).slice(0, 3)
  if (cleanFallbacks.length) body.models = cleanFallbacks

  const provider = getProviderRouting()
  if (provider) body.provider = provider

  return body
}

function statusOf(error) {
  return Number(error?.status || error?.statusCode || error?.response?.status || 0)
}

function errorText(error) {
  const parts = [
    error?.message,
    error?.error?.message,
    error?.response?.data?.error?.message,
    typeof error?.response?.data === 'string' ? error.response.data : '',
  ]
  return parts.filter(Boolean).join(' ').toLowerCase()
}

function isRetryable(error) {
  const status = statusOf(error)
  if (!status) return true
  return [408, 409, 425, 429, 500, 502, 503, 504].includes(status)
}

/**
 * Only downgrade strict JSON Schema to JSON-object mode when the provider is
 * actually rejecting the response-format capability. A missing/unavailable
 * model (404), auth problem or billing error must propagate immediately rather
 * than wasting a second API request.
 */
function isStructuredFormatUnsupported(error) {
  const status = statusOf(error)
  if (![400, 422].includes(status)) return false

  const text = errorText(error)
  return [
    'response_format',
    'response format',
    'json_schema',
    'json schema',
    'structured output',
    'structured outputs',
    'schema is not supported',
    'unsupported parameter',
  ].some(fragment => text.includes(fragment))
}

async function withRetry(label, operation) {
  let lastError

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt += 1) {
    try {
      if (attempt > 0) {
        stats.retries += 1
        const delayMs = Math.min(500 * (2 ** (attempt - 1)), 2500) + Math.floor(Math.random() * 250)
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
      return await operation(attempt)
    } catch (error) {
      lastError = error
      if (attempt >= MAX_RETRIES || !isRetryable(error)) break
      logger.warn({
        label,
        attempt: attempt + 1,
        status: statusOf(error),
        error: error?.message,
      }, 'AI gateway request failed; retrying')
    }
  }

  throw lastError || new Error(`${label} failed`)
}

function normalizeMessageContent(content) {
  if (typeof content === 'string') return content.trim()
  if (Array.isArray(content)) {
    return content
      .map(part => typeof part === 'string' ? part : (part?.text || ''))
      .join('\n')
      .trim()
  }
  return String(content || '').trim()
}

function parseJsonContent(raw) {
  const text = normalizeMessageContent(raw)
  if (!text) throw new Error('Structured AI response was empty')

  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(withoutFence)
  } catch (error) {
    const firstBrace = withoutFence.indexOf('{')
    const lastBrace = withoutFence.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1))
    }
    throw error
  }
}

function addModelControls(body, temperature) {
  // GPT-5.6 Luna on OpenRouter exposes reasoning controls but not temperature.
  // We therefore do not send sampling temperature by default. It can be enabled
  // explicitly for models/providers that support it.
  if (SEND_TEMPERATURE && Number.isFinite(temperature)) body.temperature = temperature

  if (PROVIDER === 'openrouter' && ALLOWED_REASONING_EFFORTS.has(REASONING_EFFORT)) {
    body.reasoning = { effort: REASONING_EFFORT }
  } else if (PROVIDER === 'openai' && ALLOWED_REASONING_EFFORTS.has(REASONING_EFFORT)) {
    body.reasoning_effort = REASONING_EFFORT
  }
}

async function chatCompletion({
  model = DEFAULT_MODEL,
  messages,
  maxTokens = 700,
  temperature = 0.35,
  responseFormat,
  fallbackModels,
  task = 'chat',
}) {
  if (!API_KEY) throw new Error(`No API key configured for LLM_PROVIDER=${PROVIDER}`)

  stats.totalCalls += 1
  await acquireSemaphore()
  stats.peakConcurrency = Math.max(stats.peakConcurrency, activeCalls)

  try {
    const response = await withRetry(task, async () => {
      const body = {
        model,
        messages,
        max_completion_tokens: maxTokens,
        ...buildOpenRouterExtras(model, fallbackModels),
      }

      addModelControls(body, temperature)
      if (responseFormat) body.response_format = responseFormat

      return client.chat.completions.create(body)
    })

    // Usage is billable even when a provider returns no final content. Record
    // it before validating the completion so failed/empty generations remain
    // visible in cost telemetry.
    recordUsage(response)

    const choice = response?.choices?.[0] || {}
    const content = normalizeMessageContent(choice?.message?.content)
    if (!content) {
      const usage = response?.usage || {}
      const completionTokens = Number(usage.completion_tokens || usage.output_tokens || 0)
      const reasoningTokens = Number(
        usage.completion_tokens_details?.reasoning_tokens ||
        usage.output_tokens_details?.reasoning_tokens ||
        0
      )
      const finishReason = choice?.finish_reason || 'unknown'
      throw new Error(
        `${task} returned an empty completion ` +
        `(finish_reason=${finishReason}, completion_tokens=${completionTokens}, reasoning_tokens=${reasoningTokens})`
      )
    }

    stats.successes += 1

    return {
      text: content,
      model: response?.model || model,
      usage: response?.usage || null,
      id: response?.id || null,
    }
  } catch (error) {
    stats.failures += 1
    logger.error({ task, model, status: statusOf(error), error: error?.message }, 'AI gateway request failed')
    throw error
  } finally {
    releaseSemaphore()
  }
}

async function structuredCompletion({
  model = UNDERSTANDING_MODEL,
  systemPrompt,
  userPrompt,
  schema,
  schemaName = 'ayka_structured_response',
  maxTokens = 900,
  temperature = 0.15,
  fallbackModels,
  task = 'structured',
}) {
  stats.structuredCalls += 1

  const messages = [
    { role: 'system', content: systemPrompt },
    { role: 'user', content: userPrompt },
  ]

  const strictFormat = {
    type: 'json_schema',
    json_schema: {
      name: schemaName.replace(/[^a-zA-Z0-9_-]/g, '_').slice(0, 64),
      strict: true,
      schema,
    },
  }

  try {
    const result = await chatCompletion({
      model,
      messages,
      maxTokens,
      temperature,
      responseFormat: strictFormat,
      fallbackModels,
      task,
    })
    return { ...result, data: parseJsonContent(result.text) }
  } catch (error) {
    // Some low-cost models/providers support JSON mode but not strict JSON
    // schema. Downgrade only for an actual format/schema-capability rejection.
    // Model unavailability, auth and billing failures must not consume another
    // request pretending to be a response-format fallback.
    if (!isStructuredFormatUnsupported(error)) throw error

    const status = statusOf(error)
    logger.warn({ task, model, status }, 'Strict structured output unsupported; retrying with JSON object mode')

    const schemaInstruction = [
      systemPrompt,
      '',
      'Return ONLY one JSON object matching this JSON Schema. No markdown and no commentary.',
      JSON.stringify(schema),
    ].join('\n')

    const result = await chatCompletion({
      model,
      messages: [
        { role: 'system', content: schemaInstruction },
        { role: 'user', content: userPrompt },
      ],
      maxTokens,
      temperature,
      responseFormat: { type: 'json_object' },
      fallbackModels,
      task: `${task}:json-fallback`,
    })

    return { ...result, data: parseJsonContent(result.text) }
  }
}

async function embedTexts(input, { model = EMBEDDING_MODEL } = {}) {
  if (!API_KEY) throw new Error(`No API key configured for LLM_PROVIDER=${PROVIDER}`)

  const values = Array.isArray(input) ? input : [input]
  const cleaned = values.map(value => String(value || '').trim()).filter(Boolean)
  if (!cleaned.length) return []

  // Embedding requests are real provider calls too. Count them in totalCalls so
  // aggregate telemetry cannot under-report traffic or spend.
  stats.totalCalls += 1
  stats.embeddingCalls += 1
  await acquireSemaphore()
  stats.peakConcurrency = Math.max(stats.peakConcurrency, activeCalls)

  try {
    const response = await withRetry('embeddings', () => {
      const body = {
        model,
        input: cleaned,
        encoding_format: 'float',
        ...buildOpenRouterExtras(model, []),
      }
      return client.embeddings.create(body)
    })

    // Record billable usage before validating shape, just as chat completions do.
    // A malformed provider response must still remain visible in cost telemetry.
    recordUsage(response)

    const rows = [...(response?.data || [])].sort((a, b) => a.index - b.index)
    if (rows.length !== cleaned.length) {
      throw new Error(`Embedding response count mismatch: expected ${cleaned.length}, got ${rows.length}`)
    }

    stats.successes += 1
    return rows.map(row => row.embedding)
  } catch (error) {
    stats.failures += 1
    logger.error({ model, status: statusOf(error), error: error?.message }, 'Embedding request failed')
    throw error
  } finally {
    releaseSemaphore()
  }
}

module.exports = {
  chatCompletion,
  structuredCompletion,
  embedTexts,
  getGatewayStats,
  models: {
    response: DEFAULT_MODEL,
    understanding: UNDERSTANDING_MODEL,
    validation: VALIDATION_MODEL,
    embedding: EMBEDDING_MODEL,
  },
  provider: PROVIDER,
}
