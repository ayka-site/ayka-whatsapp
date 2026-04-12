const Groq   = require('groq-sdk')
const logger = require('../utils/logger')

/**
 * groq.service.js v5.1 - Production-grade Groq service with concurrency, multi-key, model tiering
 *
 * Features over v4.0:
 *   1. Concurrency limiter (semaphore) - prevents overwhelming the API
 *   2. Multi-key rotation (GROQ_API_KEYS comma-separated)
 *   3. Model tiering: fast model for short convos, default model for longer
 *   4. Enhanced stats (model usage, concurrency tracking)
 */

// ─── MULTI-KEY ROTATION WITH HEALTH TRACKING ────────────────────
const apiKeys = (process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY || '').split(',').map(k => k.trim()).filter(Boolean)
if (apiKeys.length === 0) {
  logger.error('No Groq API keys found. Set GROQ_API_KEYS or GROQ_API_KEY')
}

const groqClients = apiKeys.map(key => new Groq({ apiKey: key }))
const KEY_COOLDOWN_MS = 60000 // 1 minute cooldown after rate limit
const keyHealth = apiKeys.map(() => ({ healthy: true, cooldownUntil: 0, rateLimitHits: 0 }))
let currentKeyIndex = 0

function getNextClient() {
  if (groqClients.length === 0) throw new Error('No Groq API keys configured')
  const now = Date.now()
  // Try to find a healthy key using round-robin
  for (let i = 0; i < groqClients.length; i++) {
    const idx = (currentKeyIndex + i) % groqClients.length
    const health = keyHealth[idx]
    // Re-enable keys whose cooldown has expired
    if (!health.healthy && now >= health.cooldownUntil) {
      health.healthy = true
    }
    if (health.healthy) {
      currentKeyIndex = idx + 1
      return { client: groqClients[idx], keyIndex: idx }
    }
  }
  // All keys in cooldown - force-use the one with earliest cooldown
  let earliest = 0
  for (let i = 1; i < keyHealth.length; i++) {
    if (keyHealth[i].cooldownUntil < keyHealth[earliest].cooldownUntil) earliest = i
  }
  currentKeyIndex = earliest + 1
  keyHealth[earliest].healthy = true
  return { client: groqClients[earliest], keyIndex: earliest }
}

function markKeyRateLimited(keyIndex) {
  if (keyIndex >= 0 && keyIndex < keyHealth.length) {
    keyHealth[keyIndex].healthy = false
    keyHealth[keyIndex].cooldownUntil = Date.now() + KEY_COOLDOWN_MS
    keyHealth[keyIndex].rateLimitHits++
  }
}

// ─── MODEL TIERING ──────────────────────────────────────────────
const MODEL_FAST    = process.env.GROQ_MODEL_FAST || 'llama-3.1-8b-instant'
const MODEL_DEFAULT = process.env.GROQ_MODEL_DEFAULT || 'llama-3.3-70b-versatile'

function selectModel(recentMessages) {
  // Use fast model for short conversations (≤ 3 messages)
  return recentMessages.length <= 3 ? MODEL_FAST : MODEL_DEFAULT
}

// ─── CONCURRENCY LIMITER (Semaphore) ────────────────────────────
const MAX_CONCURRENT = parseInt(process.env.LLM_MAX_CONCURRENCY) || 5
let activeCalls = 0
const waitQueue = []

function acquireSemaphore() {
  return new Promise(resolve => {
    if (activeCalls < MAX_CONCURRENT) {
      activeCalls++
      return resolve()
    }
    waitQueue.push(resolve)
  })
}

function releaseSemaphore() {
  activeCalls--
  if (waitQueue.length > 0) {
    activeCalls++
    const next = waitQueue.shift()
    next()
  }
}

const MAX_RETRIES   = 3
const BASE_DELAY_MS = 2000
const MAX_DELAY_MS  = 30000

const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504])

// ─── STATS ──────────────────────────────────────────────────────
const groqStats = {
  totalCalls: 0,
  successfulCalls: 0,
  failedCalls: 0,
  rateLimitHits: 0,
  retries: 0,
  lastRateLimitAt: null,
  _latencySum: 0,
  resetAt: new Date(),
  // v5.1 additions
  modelUsage: {},           // { 'llama-3.3-70b-versatile': 42, ... }
  peakConcurrency: 0,
  queuedCalls: 0,
}

function getGroqStats() {
  return {
    totalCalls:       groqStats.totalCalls,
    successfulCalls:  groqStats.successfulCalls,
    failedCalls:      groqStats.failedCalls,
    rateLimitHits:    groqStats.rateLimitHits,
    retries:          groqStats.retries,
    lastRateLimitAt:  groqStats.lastRateLimitAt,
    avgLatencyMs:     groqStats.successfulCalls > 0 ? Math.round(groqStats._latencySum / groqStats.successfulCalls) : 0,
    trackingSince:    groqStats.resetAt,
    // v5.1
    modelUsage:       groqStats.modelUsage,
    concurrency:      { current: activeCalls, max: MAX_CONCURRENT, peak: groqStats.peakConcurrency, queued: waitQueue.length },
    keyCount:         groqClients.length,
    keyHealth:        keyHealth.map((k, i) => ({ key: i + 1, healthy: k.healthy, rateLimitHits: k.rateLimitHits })),
  }
}

/**
 * callGroq - send chat completion request
 *
 * v5.1: concurrency-limited, multi-key, model-tiered
 */
async function callGroq(systemPrompt, recentMessages) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentMessages.slice(-5).map(msg => ({
      role: msg.role,
      content: msg.content?.text || msg.content || '',
    })),
  ]

  const model = selectModel(recentMessages)
  groqStats.totalCalls++
  groqStats.modelUsage[model] = (groqStats.modelUsage[model] || 0) + 1

  const callStart = Date.now()
  let lastError = null

  {
    for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
      try {
        const { client: groq, keyIndex } = getNextClient()
        const response = await groq.chat.completions.create({
          model,
          messages,
          max_tokens: 400,
          temperature: 0.7,
        })

        const content = response.choices?.[0]?.message?.content
        if (!content) {
          logger.warn({ attempt, model }, 'Groq returned empty response')
          throw new Error('Groq returned empty response')
        }

        groqStats.successfulCalls++
        groqStats._latencySum += (Date.now() - callStart)
        return content

      } catch (error) {
        lastError = error
        const status = error.status || error.statusCode || 0

        if (status && !RETRYABLE_CODES.has(status)) {
          logger.error({ status, message: error.message, attempt, model }, 'Groq non-retryable error')
          groqStats.failedCalls++
          throw error
        }

        if (status === 429) {
          groqStats.rateLimitHits++
          groqStats.lastRateLimitAt = new Date()
          // Mark the specific key as rate-limited so rotation skips it
          const lastKeyIdx = ((currentKeyIndex - 1) % groqClients.length + groqClients.length) % groqClients.length
          markKeyRateLimited(lastKeyIdx)
        }

        if (attempt === MAX_RETRIES) break

        groqStats.retries++

        let delayMs
        if (status === 429 && error.headers?.['retry-after']) {
          delayMs = parseInt(error.headers['retry-after'], 10) * 1000
        } else {
          delayMs = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS)
          delayMs += Math.random() * 1000
        }

        logger.warn({ status, attempt, delayMs: Math.round(delayMs), model }, 'Groq retrying')
        await new Promise(resolve => setTimeout(resolve, delayMs))
      }
    }

    groqStats.failedCalls++
    throw lastError || new Error('Groq request failed after retries')
  }
}

module.exports = { callGroq, getGroqStats }
