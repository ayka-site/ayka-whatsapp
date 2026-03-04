const logger = require('../utils/logger')

/**
 * llm.service.js v1.0 — Unified LLM gateway
 *
 * Priority chain:
 *   1. Gemini 2.0 Flash (primary — free 1500 RPD, great Hindi/Hinglish)
 *   2. Groq  (fallback  — multi-key rotation, model tiering)
 *   3. Azure OpenAI (last resort)
 *
 * Single export: callLLM(systemPrompt, recentMessages) → string
 * Drop-in replacement for callGroq everywhere.
 */

// ─── GEMINI (Google Generative AI) ──────────────────────────────
const { GoogleGenerativeAI } = require('@google/generative-ai')

const GEMINI_API_KEY = process.env.GEMINI_API_KEY || ''
let geminiModel = null

if (GEMINI_API_KEY) {
  try {
    const genAI = new GoogleGenerativeAI(GEMINI_API_KEY)
    geminiModel = genAI.getGenerativeModel({
      model: process.env.GEMINI_MODEL || 'gemini-2.0-flash',
      generationConfig: {
        maxOutputTokens: 400,
        temperature: 0.7,
      },
    })
    logger.info('Gemini Flash initialized as primary LLM')
  } catch (err) {
    logger.warn({ err }, 'Gemini init failed — will use Groq as primary')
  }
} else {
  logger.info('No GEMINI_API_KEY — using Groq as primary LLM')
}

// ─── GROQ (multi-key, model tiering, retries) ──────────────────
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
    groqStats: getGroqStats(),
    concurrency: { current: activeCalls, max: MAX_CONCURRENT, peak: llmStats.peakConcurrency, queued: waitQueue.length },
  }
}

// ─── GEMINI CALL ────────────────────────────────────────────────
async function callGemini(systemPrompt, recentMessages) {
  if (!geminiModel) return null

  // Gemini uses a different message format:
  // - systemInstruction is set at model level, we pass it in generateContent
  // - contents: [{ role: 'user'|'model', parts: [{ text }] }]
  const contents = recentMessages.slice(-6).map(msg => ({
    role: msg.role === 'assistant' ? 'model' : 'user',
    parts: [{ text: msg.content?.text || msg.content || '' }],
  }))

  // If no user messages, create one from the last message
  if (contents.length === 0) {
    contents.push({ role: 'user', parts: [{ text: '(start)' }] })
  }

  // Ensure conversation starts with a user message (Gemini requirement)
  if (contents[0].role !== 'user') {
    contents.unshift({ role: 'user', parts: [{ text: '(context)' }] })
  }

  // Ensure alternating roles — Gemini requires strict user/model alternation
  const cleaned = []
  for (const msg of contents) {
    if (cleaned.length > 0 && cleaned[cleaned.length - 1].role === msg.role) {
      // Merge consecutive same-role messages
      cleaned[cleaned.length - 1].parts[0].text += '\n' + msg.parts[0].text
    } else {
      cleaned.push(msg)
    }
  }

  try {
    const result = await geminiModel.generateContent({
      systemInstruction: { parts: [{ text: systemPrompt }] },
      contents: cleaned,
    })

    const text = result.response?.text()
    if (!text) {
      logger.warn('Gemini returned empty response')
      return null
    }
    return text
  } catch (err) {
    const status = err.status || err.httpStatusCode || 0
    // 429 = rate limited, 500/503 = server issues — all worth falling back
    logger.warn({ status, message: err.message }, 'Gemini call failed — falling back to Groq')
    return null
  }
}

// ─── UNIFIED CALL ───────────────────────────────────────────────
/**
 * callLLM — drop-in replacement for callGroq
 * @param {string} systemPrompt - full system prompt
 * @param {Array}  recentMessages - [{role, content}]
 * @returns {string} AI response text
 */
async function callLLM(systemPrompt, recentMessages) {
  llmStats.totalCalls++

  await acquireSemaphore()
  if (activeCalls > llmStats.peakConcurrency) llmStats.peakConcurrency = activeCalls

  try {
    // ── 1. Try Gemini Flash (primary) ──
    llmStats.geminiCalls++
    const geminiResult = await callGemini(systemPrompt, recentMessages)
    if (geminiResult) {
      llmStats.geminiSuccesses++
      return geminiResult
    }
    llmStats.geminiFails++

    // ── 2. Fallback to Groq (has its own retries + Azure fallback) ──
    llmStats.groqFallbacks++
    logger.info('Falling back to Groq')
    const groqResult = await callGroq(systemPrompt, recentMessages)
    llmStats.groqFallbackSuccesses++
    return groqResult

  } finally {
    releaseSemaphore()
  }
}

module.exports = { callLLM, getLLMStats, callGemini, callGroq }
