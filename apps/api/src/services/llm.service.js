const { chatCompletion, getGatewayStats, models } = require('./ai.gateway.service')
const { callSchoolReceptionist } = require('./ai.receptionist.service')

/**
 * Provider-neutral LLM compatibility layer.
 *
 * Existing callers still use callLLM(systemPrompt, recentMessages) -> string.
 * School turns are upgraded to the semantic receptionist pipeline while other
 * verticals continue using their existing prompts through the same configurable
 * OpenAI-compatible gateway.
 */

const MAX_CONTEXT_TOKENS = Math.max(1200, Number.parseInt(process.env.LLM_MAX_CONTEXT_TOKENS || '6000', 10) || 6000)
const configuredTemperature = Number.parseFloat(process.env.LLM_TEMPERATURE || '0.35')
const LLM_TEMPERATURE = Number.isFinite(configuredTemperature)
  ? Math.min(Math.max(configuredTemperature, 0), 1.0)
  : 0.35

function estimateTokens(text) {
  return Math.ceil(String(text || '').length / 4)
}

function trimRecentMessagesToTokenBudget(recentMessages, budgetTokens = MAX_CONTEXT_TOKENS) {
  const normalized = (recentMessages || []).map(message => ({
    role: message.role === 'assistant' ? 'assistant' : 'user',
    content: String(message.content?.text || message.content || ''),
  }))

  let total = normalized.reduce((sum, message) => sum + estimateTokens(message.content), 0)
  while (normalized.length > 1 && total > budgetTokens) {
    const removed = normalized.shift()
    total -= estimateTokens(removed.content)
  }
  return normalized
}

function isSchoolAdmissionsPrompt(systemPrompt) {
  const text = String(systemPrompt || '')
  if (!text) return false

  return (
    text.includes('KNOWN FACTS (say ONLY what is here - never invent)') &&
    text.includes('MEMORY (ABSOLUTE TRUTH - NEVER CONTRADICT)') &&
    /admissions counsellor at/i.test(text)
  )
}

async function callGenericLLM(systemPrompt, recentMessages) {
  const result = await chatCompletion({
    model: models.response,
    messages: [
      { role: 'system', content: systemPrompt },
      ...trimRecentMessagesToTokenBudget(recentMessages),
    ],
    maxTokens: 400,
    temperature: LLM_TEMPERATURE,
    task: 'generic-llm',
  })
  return result.text
}

async function callLLM(systemPrompt, recentMessages) {
  if (isSchoolAdmissionsPrompt(systemPrompt)) {
    return callSchoolReceptionist({
      legacySystemPrompt: systemPrompt,
      recentMessages,
    })
  }

  return callGenericLLM(systemPrompt, recentMessages)
}

function getLLMStats() {
  return {
    ...getGatewayStats(),
    architecture: 'provider-neutral-ai-receptionist-v2',
  }
}

module.exports = {
  callLLM,
  getLLMStats,
  _private: {
    estimateTokens,
    trimRecentMessagesToTokenBudget,
    isSchoolAdmissionsPrompt,
  },
}
