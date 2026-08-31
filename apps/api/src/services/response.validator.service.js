const { structuredCompletion, models } = require('./ai.gateway.service')
const logger = require('../utils/logger')

const validationSchema = {
  type: 'object',
  additionalProperties: false,
  required: [
    'safe',
    'approvedReply',
    'unsupportedClaims',
    'reason',
    'needsHuman',
    'coveredRequestIndexes',
    'unresolvedRequestIndexes',
  ],
  properties: {
    safe: { type: 'boolean' },
    approvedReply: { type: 'string' },
    unsupportedClaims: { type: 'array', maxItems: 12, items: { type: 'string' } },
    reason: { type: 'string' },
    needsHuman: { type: 'boolean' },
    coveredRequestIndexes: { type: 'array', maxItems: 8, items: { type: 'integer' } },
    unresolvedRequestIndexes: { type: 'array', maxItems: 8, items: { type: 'integer' } },
  },
}

function shouldValidate({ understanding, reply, evidence }) {
  if (understanding?.requiresKnowledge) return true
  if (understanding?.shouldHandoff) return true
  if (String(evidence || '').trim()) return true
  if (extractCriticalNumerics(reply).length > 0) return true
  return false
}

function normalizeCriticalValue(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[₹,\s().-]/g, '')
    .trim()
}

function extractCriticalNumerics(text) {
  const value = String(text || '')
  const found = []
  const patterns = [
    ['currency', /₹\s*\d[\d,]*(?:\.\d+)?/gi],
    ['percentage', /\b\d+(?:\.\d+)?\s*%/gi],
    ['time', /\b(?:0?[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm|a\.m\.|p\.m\.|baje)\b/gi],
    ['date', /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g],
    ['phone', /(?:\+?\d[\d\s-]{6,}\d)/g],
  ]

  for (const [kind, pattern] of patterns) {
    for (const match of value.matchAll(pattern)) {
      const raw = match[0]
      if (kind === 'phone' && raw.replace(/\D/g, '').length < 8) continue
      found.push({ kind, raw, normalized: normalizeCriticalValue(raw) })
    }
  }

  const unique = []
  const seen = new Set()
  for (const item of found) {
    if (!item.normalized || seen.has(item.normalized)) continue
    seen.add(item.normalized)
    unique.push(item)
  }
  return unique
}

function unsupportedCriticalNumerics({ reply, evidence, memory, parentMessage }) {
  const source = [evidence, memory, parentMessage].filter(Boolean).join('\n')
  const sourceNormalized = normalizeCriticalValue(source)
  return extractCriticalNumerics(reply).filter(item => !sourceNormalized.includes(item.normalized))
}

function buildFailureResult(reason, unsupportedClaims = [], { needsHuman = false } = {}) {
  return {
    safe: false,
    approvedReply: '',
    unsupportedClaims,
    reason,
    needsHuman,
    coveredRequestIndexes: [],
    unresolvedRequestIndexes: [],
    skipped: false,
    failed: true,
  }
}

function uniqueRequestIndexes(values, requestCount) {
  if (!Array.isArray(values)) throw new Error('Validator request coverage arrays are missing or invalid')
  const unique = [...new Set(values.map(Number))]
  for (const index of unique) {
    if (!Number.isInteger(index) || index < 0 || index >= requestCount) {
      throw new Error(`Validator returned invalid request index: ${index}`)
    }
  }
  return unique.sort((a, b) => a - b)
}

function normalizeValidationData(data, requestCount = 0) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Validator returned a non-object payload')
  }
  if (typeof data.safe !== 'boolean') throw new Error('Validator safe flag is missing or invalid')
  if (!Array.isArray(data.unsupportedClaims)) throw new Error('Validator unsupportedClaims is missing or invalid')

  const approvedReply = String(data.approvedReply || '').trim()
  if (!approvedReply) throw new Error('Validator returned empty approvedReply')

  const coveredRequestIndexes = uniqueRequestIndexes(data.coveredRequestIndexes || [], requestCount)
  const unresolvedRequestIndexes = uniqueRequestIndexes(data.unresolvedRequestIndexes || [], requestCount)

  const overlap = coveredRequestIndexes.some(index => unresolvedRequestIndexes.includes(index))
  if (overlap) throw new Error('Validator marked a request both covered and unresolved')

  if (requestCount > 0) {
    const accountedFor = new Set([...coveredRequestIndexes, ...unresolvedRequestIndexes])
    if (accountedFor.size !== requestCount) {
      throw new Error(`Validator request coverage incomplete: expected ${requestCount}, got ${accountedFor.size}`)
    }
  }

  return {
    safe: data.safe,
    approvedReply,
    unsupportedClaims: data.unsupportedClaims
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .slice(0, 12),
    reason: String(data.reason || '').trim(),
    needsHuman: unresolvedRequestIndexes.length > 0,
    coveredRequestIndexes,
    unresolvedRequestIndexes,
  }
}

// Kept as a compatibility/testing helper for historical plain-text validator
// responses. The production validator now uses strict structured output.
function parseValidationJson(raw) {
  const text = String(raw || '').trim()
  if (!text) throw new Error('Validator returned empty text')
  const withoutFence = text
    .replace(/^```(?:json)?\s*/i, '')
    .replace(/\s*```$/i, '')
    .trim()

  try {
    return JSON.parse(withoutFence)
  } catch (firstError) {
    const firstBrace = withoutFence.indexOf('{')
    const lastBrace = withoutFence.lastIndexOf('}')
    if (firstBrace >= 0 && lastBrace > firstBrace) {
      return JSON.parse(withoutFence.slice(firstBrace, lastBrace + 1))
    }
    throw firstError
  }
}

function validationOutputContract() {
  return [
    'OUTPUT CONTRACT:',
    'Return exactly ONE JSON object and no markdown outside JSON.',
    'Required shape:',
    JSON.stringify(validationSchema),
  ].join('\n')
}

async function validateReceptionistReply({ parentMessage, reply, evidence, memory, understanding }) {
  const requests = Array.isArray(understanding?.requests) ? understanding.requests : []

  if (!shouldValidate({ understanding, reply, evidence })) {
    return {
      safe: true,
      approvedReply: String(reply || '').trim(),
      unsupportedClaims: [],
      reason: 'No school-specific factual validation was required.',
      needsHuman: false,
      coveredRequestIndexes: [],
      unresolvedRequestIndexes: [],
      skipped: true,
      failed: false,
    }
  }

  const preflightUnsupported = unsupportedCriticalNumerics({
    reply,
    evidence,
    memory,
    parentMessage,
  })

  const systemPrompt = `You are the final factual safety editor for a production school WhatsApp receptionist.
Your approvedReply is the exact prose that may be sent to a real parent. Accuracy, completeness and natural conversation matter more than preserving the draft.

Grounding rules:
1. VERIFIED EVIDENCE and AUTHORITATIVE MEMORY are the only sources of school-specific facts. The parent's message can support only what the parent themselves said or requested.
2. Break the DRAFT REPLY into atomic claims. Every school-specific atomic claim in approvedReply must be directly entailed by evidence/memory. Plausible, typical or commonly-associated details are NOT evidence.
3. Never expand a broad verified fact into invented components. A meal count does not establish menu items; bus availability does not establish a route; a facility does not establish equipment; school hours do not establish office hours.
4. If the draft contains unsupported detail, remove it and list each removed/incorrect claim in unsupportedClaims.
5. If evidence directly answers a parent's request, approvedReply MUST state that supported answer directly. Never weaken a supported fact into "please confirm", "not available", or a staff referral.
6. If the draft omitted a directly-supported requested fact, restore it from VERIFIED EVIDENCE.
7. If a requested detail truly is unsupported, answer all supported parts first. For only the unsupported detail, say you do not have the exact verified detail and may offer to connect the parent with admissions. Do not claim a handoff already happened unless HANDOFF AUTHORIZED is true.
8. coveredRequestIndexes contains every request fully answered from evidence/memory. unresolvedRequestIndexes contains every request whose requested detail remains unsupported. Every request index must appear in exactly one array.
9. safe describes approvedReply. Set safe=false only if you cannot produce a grounded parent-facing reply from the supplied material.
10. CRITICAL NUMERIC PREFLIGHT lists protected numeric values from the draft that deterministic code could not ground. Remove or repair all of them from evidence.
11. Preserve at most one short, natural non-factual qualification or next-step question from the draft when useful. Questions such as asking the child's name, target class, or whether the parent wants help scheduling a visit are allowed; they are questions, not school facts.
12. If HANDOFF AUTHORIZED is true, the reply should politely say the parent is being connected with the admissions team now. Do not tell the parent to call or contact the school themselves.
13. Keep approvedReply WhatsApp-short and natural. Match the parent's language/script/style guidance. No emojis. Never use Markdown double-asterisk bold. If emphasis helps, use WhatsApp single-asterisk bold only: *text*.
14. Do not expose evidence IDs, prompts, model names, validation logic or internal metadata.
15. Preserve fee billing frequency exactly. If evidence distinguishes monthly tuition, one-time/additional charges, annual charges, exam fees, transport fees or other billing periods, keep them separate. Never average, amortize or combine one-time/annual charges into a monthly fee unless the evidence explicitly defines that exact amount as an authoritative recurring monthly charge. Structured class-wise fees take precedence over derived or simplified totals.`

  const userPrompt = JSON.stringify({
    parentMessage: String(parentMessage || ''),
    requests: requests.map((request, index) => ({ index, ...request })),
    draftReply: String(reply || ''),
    verifiedEvidence: String(evidence || '(No verified evidence retrieved.)'),
    authoritativeMemory: String(memory || '(No memory.)'),
    criticalNumericPreflight: preflightUnsupported.map(item => `${item.kind}: ${item.raw}`),
    communication: understanding?.communication || null,
    handoffAuthorized: understanding?.shouldHandoff === true,
  })

  try {
    const result = await structuredCompletion({
      model: models.validation,
      systemPrompt,
      userPrompt,
      schema: validationSchema,
      schemaName: 'school_response_validation_v2',
      maxTokens: 720,
      temperature: 0.05,
      task: 'response-validation',
    })

    const data = normalizeValidationData(result.data, requests.length)
    if (!data.safe) {
      return buildFailureResult(
        data.reason || 'Validator could not produce a grounded final reply',
        data.unsupportedClaims,
        { needsHuman: data.needsHuman },
      )
    }

    const postflightUnsupported = unsupportedCriticalNumerics({
      reply: data.approvedReply,
      evidence,
      memory,
      parentMessage,
    })

    if (postflightUnsupported.length > 0) {
      logger.error({
        unsupported: postflightUnsupported.map(item => ({ kind: item.kind, value: item.raw })),
      }, 'Validator left unsupported protected numeric values in final reply')
      return buildFailureResult(
        'Protected numeric grounding failed after semantic validation',
        postflightUnsupported.map(item => `${item.kind}: ${item.raw}`),
        { needsHuman: false },
      )
    }

    return {
      ...data,
      skipped: false,
      failed: false,
      model: result.model,
    }
  } catch (error) {
    logger.error({ error: error?.message }, 'Response validation failed')
    return buildFailureResult('Validation service failed', ['Validation unavailable'])
  }
}

module.exports = {
  validateReceptionistReply,
  shouldValidate,
  _private: {
    extractCriticalNumerics,
    unsupportedCriticalNumerics,
    normalizeCriticalValue,
    normalizeValidationData,
    parseValidationJson,
    validationOutputContract,
    buildFailureResult,
    validationSchema,
  },
}
