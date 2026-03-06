const logger = require('../utils/logger')

/**
 * llm.service.js v3.0 — Groq-only LLM gateway
 *
 * Primary: Groq Llama-70B — multi-key rotation, model tiering, retries
 * (Gemini removed — revert to stable Groq-only stack)
 */

// ─── GROQ (primary — multi-key, model tiering, retries) ─────────
const { callGroq, getGroqStats } = require('./groq.service')

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
  groqCalls: 0,
  groqSuccesses: 0,
  peakConcurrency: 0,
  resetAt: new Date(),
}

function getLLMStats() {
  return {
    ...llmStats,
    provider: 'groq',
    groqStats: getGroqStats(),
    concurrency: { current: activeCalls, max: MAX_CONCURRENT, peak: llmStats.peakConcurrency, queued: waitQueue.length },
  }
}

// ─── UNIFIED CALL ───────────────────────────────────────────────
/**
 * callLLM(systemPrompt, recentMessages) → string
 *
 * Primary: Groq Llama-70B (multi-key rotation, own retry logic)
 */
async function callLLM(systemPrompt, recentMessages) {
  llmStats.totalCalls++

  await acquireSemaphore()
  if (activeCalls > llmStats.peakConcurrency) llmStats.peakConcurrency = activeCalls

  try {
    llmStats.groqCalls++
    const result = await callGroq(systemPrompt, recentMessages)
    llmStats.groqSuccesses++
    return result
  } finally {
    releaseSemaphore()
  }
}

module.exports = { callLLM, getLLMStats, callGroq }
