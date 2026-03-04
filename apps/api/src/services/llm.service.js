const logger = require('../utils/logger')

/**
 * llm.service.js v2.0 — Unified LLM gateway
 *
 * Priority chain:
 *   1. Gemini 3 Flash (primary) — gemini-3-flash-preview, thinking: minimal
 *   2. Groq Llama-70B (fallback) — multi-key rotation
 *
 * Uses new @google/genai SDK (required for Gemini 3 models)
 * History window: last 5 messages
 */

// ─── GEMINI (@google/genai — new SDK for Gemini 3) ──────────────
const { GoogleGenAI } = require('@google/genai')

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
const GEMINI_MODEL   = process.env.GEMINI_MODEL || 'gemini-3-flash-preview'

let geminiClient = null

if (GEMINI_API_KEY) {
  try {
    geminiClient = new GoogleGenAI({ apiKey: GEMINI_API_KEY })
    logger.info({ model: GEMINI_MODEL }, 'Gemini 3 Flash initialized as primary LLM')
  } catch (err) {
    logger.warn({ err }, 'Gemini init failed — will use Groq as primary')
  }
} else {
  logger.warn('No GEMINI_API_KEY set — falling back to Groq as primary LLM')
}

// ─── GROQ (fallback — multi-key, model tiering, retries) ────────
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
  geminiCalls: 0,
  geminiSuccesses: 0,
  geminiFails: 0,
  groqFallbacks: 0,
  groqFallbackSuccesses: 0,
  peakConcurrency: 0,
  resetAt: new Date(),
}

function getLLMStats() {
  return {
    ...llmStats,
    model: GEMINI_MODEL,
    groqStats: getGroqStats(),
    concurrency: { current: activeCalls, max: MAX_CONCURRENT, peak: llmStats.peakConcurrency, queued: waitQueue.length },
  }
}

// ─── BUILD GEMINI CONTENTS ──────────────────────────────────────
// Gemini 3 requires:
//   - contents: [{ role: 'user'|'model', parts: [{ text }] }]
//   - Strict alternation: must start with 'user', no two same roles in a row
//   - systemInstruction passed in config, NOT as a message
function buildGeminiContents(recentMessages) {
  // Take last 5 messages
  const raw = recentMessages.slice(-5).map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: (msg.content?.text || msg.content || '').trim() }],
  }))

  // Merge consecutive same-role messages to satisfy alternation requirement
  const merged = []
  for (const msg of raw) {
    if (merged.length > 0 && merged[merged.length - 1].role === msg.role) {
      merged[merged.length - 1].parts[0].text += '\n' + msg.parts[0].text
    } else {
      merged.push({ role: msg.role, parts: [{ text: msg.parts[0].text }] })
    }
  }

  // Must start with 'user'
  if (merged.length === 0 || merged[0].role !== 'user') {
    merged.unshift({ role: 'user', parts: [{ text: '...' }] })
  }

  return merged
}

// ─── GEMINI CALL ────────────────────────────────────────────────
async function callGemini(systemPrompt, recentMessages) {
  if (!geminiClient) return null

  const contents = buildGeminiContents(recentMessages)

  try {
    const response = await geminiClient.models.generateContent({
      model: GEMINI_MODEL,
      contents,
      config: {
        systemInstruction: systemPrompt,
        maxOutputTokens: 400,
        temperature: 1.0,       // Gemini 3 official recommendation: keep at 1.0
        thinkingConfig: {
          thinkingLevel: 'minimal', // Fastest + cheapest for WhatsApp chat
        },
      },
    })

    const text = response.text
    if (!text || !text.trim()) {
      logger.warn({ model: GEMINI_MODEL }, 'Gemini returned empty response')
      return null
    }

    return text.trim()

  } catch (err) {
    const status = err.status || err.httpStatusCode || err.code || 0
    logger.warn({ status, message: err.message, model: GEMINI_MODEL }, 'Gemini call failed — falling back to Groq')
    return null
  }
}

// ─── UNIFIED CALL ───────────────────────────────────────────────
/**
 * callLLM(systemPrompt, recentMessages) → string
 *
 * Primary:  Gemini 3 Flash (gemini-3-flash-preview, thinking: minimal)
 * Fallback: Groq Llama-70B (multi-key rotation, own retry logic)
 */
async function callLLM(systemPrompt, recentMessages) {
  llmStats.totalCalls++

  await acquireSemaphore()
  if (activeCalls > llmStats.peakConcurrency) llmStats.peakConcurrency = activeCalls

  try {
    // ── 1. Gemini 3 Flash (primary) ──
    llmStats.geminiCalls++
    const geminiResult = await callGemini(systemPrompt, recentMessages)
    if (geminiResult) {
      llmStats.geminiSuccesses++
      return geminiResult
    }
    llmStats.geminiFails++
    logger.warn('Gemini failed — switching to Groq fallback')

    // ── 2. Groq Llama-70B (fallback) ──
    llmStats.groqFallbacks++
    const groqResult = await callGroq(systemPrompt, recentMessages)
    llmStats.groqFallbackSuccesses++
    return groqResult

  } finally {
    releaseSemaphore()
  }
}

module.exports = { callLLM, getLLMStats, callGemini, callGroq }
