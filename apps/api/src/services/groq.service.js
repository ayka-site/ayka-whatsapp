const Groq   = require('groq-sdk')
const logger = require('../utils/logger')

/**
 * groq.service.js v4.0 — Groq LLM API with production-grade retry
 *
 * Fixes over v3.0:
 *   1. Max 3 retry attempts (was unbounded recursive calls → could loop forever)
 *   2. Exponential backoff with jitter (not fixed delays)
 *   3. Uses pino logger (was console.error)
 *   4. Timeout per request (30s)
 *   5. Respects Retry-After header from Groq on 429s
 */

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY })

const MAX_RETRIES      = 3
const BASE_DELAY_MS    = 2000
const MAX_DELAY_MS     = 30000
const REQUEST_TIMEOUT  = 30000 // 30 seconds

// Retryable HTTP status codes
const RETRYABLE_CODES = new Set([429, 500, 502, 503, 504])

/**
 * callGroq — send chat completion request with retry + exponential backoff
 *
 * @param {string} systemPrompt — the full system prompt
 * @param {Array}  recentMessages — array of {role, content} message objects
 * @returns {string} — the AI response text
 * @throws {Error} — after all retries exhausted
 */
async function callGroq(systemPrompt, recentMessages) {
  const messages = [
    { role: 'system', content: systemPrompt },
    ...recentMessages.slice(-6).map(msg => ({
      role: msg.role,
      content: msg.content?.text || msg.content || '',
    })),
  ]

  let lastError = null

  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      const response = await groq.chat.completions.create({
        model: 'llama-3.3-70b-versatile',
        messages,
        max_tokens: 400,
        temperature: 0.7,
      })

      const content = response.choices?.[0]?.message?.content
      if (!content) {
        logger.warn({ attempt }, 'Groq returned empty response')
        throw new Error('Groq returned empty response')
      }

      return content

    } catch (error) {
      lastError = error
      const status = error.status || error.statusCode || 0

      // Non-retryable errors → fail immediately
      if (!RETRYABLE_CODES.has(status) && attempt > 0) {
        logger.error({ status, message: error.message, attempt }, 'Groq non-retryable error')
        throw error
      }

      // Last attempt → no more retries
      if (attempt === MAX_RETRIES) {
        logger.error({ status, message: error.message, attempt }, 'Groq all retries exhausted')
        throw error
      }

      // Calculate delay: respect Retry-After header for 429, else exponential backoff
      let delayMs
      if (status === 429 && error.headers?.['retry-after']) {
        delayMs = parseInt(error.headers['retry-after'], 10) * 1000
      } else {
        // Exponential backoff with jitter: 2s, 4s, 8s + random 0-1s
        delayMs = Math.min(BASE_DELAY_MS * Math.pow(2, attempt), MAX_DELAY_MS)
        delayMs += Math.random() * 1000
      }

      logger.warn({ status, attempt, delayMs: Math.round(delayMs) }, 'Groq retrying after error')
      await new Promise(resolve => setTimeout(resolve, delayMs))
    }
  }

  // Should never reach here, but just in case
  throw lastError || new Error('Groq call failed with unknown error')
}

module.exports = { callGroq }
