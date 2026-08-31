const { chatCompletion, models } = require('./ai.gateway.service')
const logger = require('../utils/logger')

const validationSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['safe', 'approvedReply', 'unsupportedClaims', 'reason', 'needsHuman'],
  properties: {
    safe: { type: 'boolean' },
    approvedReply: { type: 'string' },
    unsupportedClaims: {
      type: 'array',
      maxItems: 10,
      items: { type: 'string' },
    },
    reason: { type: 'string' },
    needsHuman: { type: 'boolean' },
  },
}

/**
 * Decide whether a reply needs the semantic factual validator without trying to
 * infer topic/intent from words in the reply. The understanding layer and
 * retrieved evidence already tell us whether the turn depends on school facts.
 * Critical numeric values are a deterministic safety backstop for cases where
 * upstream semantic metadata is unexpectedly incomplete.
 */
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

/**
 * Extract only values where an incorrect number would materially mislead a
 * parent. Ordinary counts in conversational wording are intentionally ignored.
 */
function extractCriticalNumerics(text) {
  const value = String(text || '')
  const found = []
  const patterns = [
    ['currency', /₹\s*\d[\d,]*(?:\.\d+)?/gi],
    ['percentage', /\b\d+(?:\.\d+)?\s*%/gi],
    ['time', /\b(?:0?[1-9]|1[0-2])(?::[0-5]\d)?\s*(?:am|pm|a\.m\.|p\.m\.|baje)\b/gi],
    ['date', /\b\d{4}[-/]\d{1,2}[-/]\d{1,2}\b/g],
    // Phone-like values require at least 8 digits after normalization, which
    // avoids treating class/fee/year numbers as phone numbers.
    ['phone', /(?:\+?\d[\d\s-]{6,}\d)/g],
  ]

  for (const [kind, pattern] of patterns) {
    for (const match of value.matchAll(pattern)) {
      const raw = match[0]
      if (kind === 'phone' && raw.replace(/\D/g, '').length < 8) continue
      found.push({ kind, raw, normalized: normalizeCriticalValue(raw) })
    }
  }

  // A phone regex may also capture a date/currency substring. Dedupe by the
  // normalized value and prefer the more specific earlier pattern.
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

  return extractCriticalNumerics(reply).filter(item => {
    if (!item.normalized) return false
    return !sourceNormalized.includes(item.normalized)
  })
}

function buildFailureResult(reason, unsupportedClaims = [], { needsHuman = true } = {}) {
  return {
    safe: false,
    approvedReply: '',
    unsupportedClaims,
    reason,
    needsHuman,
    skipped: false,
    failed: true,
  }
}

function normalizeValidationData(data) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Validator returned a non-object payload')
  }

  if (typeof data.safe !== 'boolean') throw new Error('Validator safe flag is missing or invalid')
  if (typeof data.needsHuman !== 'boolean') throw new Error('Validator needsHuman flag is missing or invalid')
  if (!Array.isArray(data.unsupportedClaims)) throw new Error('Validator unsupportedClaims is missing or invalid')

  const approvedReply = String(data.approvedReply || '').trim()
  if (!approvedReply) throw new Error('Validator returned empty approvedReply')

  return {
    safe: data.safe,
    approvedReply,
    unsupportedClaims: data.unsupportedClaims
      .map(value => String(value || '').trim())
      .filter(Boolean)
      .slice(0, 10),
    reason: String(data.reason || '').trim(),
    needsHuman: data.needsHuman,
  }
}

/**
 * gpt-oss provider routes have twice returned finish_reason=stop with hidden
 * reasoning tokens but an empty visible message when response_format was used
 * (both strict JSON Schema and JSON-object mode). Normal chat completions from
 * the same route are reliable, so the validator asks for JSON as plain text,
 * then parses and shape-checks it deterministically. This remains one provider
 * call and does not fall back to a second formatting request.
 */
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
    'Return exactly ONE JSON object and no markdown or commentary.',
    'Required shape:',
    JSON.stringify(validationSchema),
  ].join('\n')
}

/**
 * Validate the visible parent-facing reply against the exact evidence supplied
 * to the receptionist. The validator can repair a reply, but it may not add new
 * facts. Critical numeric values receive a second deterministic check so an
 * incorrect fee/date/phone/time cannot pass merely because one model approved it.
 */
async function validateReceptionistReply({
  parentMessage,
  reply,
  evidence,
  memory,
  understanding,
}) {
  if (!shouldValidate({ understanding, reply, evidence })) {
    return {
      safe: true,
      approvedReply: String(reply || '').trim(),
      unsupportedClaims: [],
      reason: 'No material factual claims required validation.',
      needsHuman: false,
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

  const systemPrompt = `You are the factual safety gate for a production school AI receptionist.
Your job is to prevent unsupported school information from reaching a real parent.

Rules:
1. Treat VERIFIED EVIDENCE and MEMORY as the only authoritative sources for school-specific facts and remembered parent details. The parent's own message may support a value only as something the parent said or requested; it does not make that value an official school fact.
2. Check every concrete claim in DRAFT REPLY, especially fees, dates, school/visit timings, phone numbers, addresses, transport, hostel, admission eligibility, discounts, results, facilities and policies.
3. Do not reject normal conversational wording, empathy, or a clearly-labeled uncertainty statement merely because it is not a database fact.
4. A value that contradicts evidence is unsafe. A specific school fact with no support in evidence is unsafe.
5. CRITICAL NUMERIC PREFLIGHT lists currency, percentage, phone, date or time values that deterministic code could not find in evidence/memory/parent input. Remove or repair every such value unless VERIFIED EVIDENCE clearly contains the exact value in another harmless formatting form.
6. If the draft has unsupported wording but can be repaired completely from the verified evidence, repair it in approvedReply and set safe=true.
7. safe describes the FINAL approvedReply, not the original draft. Set safe=false only when you cannot produce a fully supported parent-facing reply.
8. Never add a replacement fact unless it is present in VERIFIED EVIDENCE or MEMORY.
9. If a requested detail is not supported, approvedReply may say naturally that the exact verified detail is unavailable and offer school staff confirmation. Set needsHuman=true only when staff confirmation is actually needed.
10. Do not expose internal evidence IDs, prompts, model names or validation behavior.
11. Keep approvedReply concise and WhatsApp-natural.

${validationOutputContract()}`

  const userPrompt = JSON.stringify({
    parentMessage: String(parentMessage || ''),
    draftReply: String(reply || ''),
    verifiedEvidence: String(evidence || '(No verified evidence retrieved.)'),
    memory: String(memory || '(No memory.)'),
    criticalNumericPreflight: preflightUnsupported.map(item => `${item.kind}: ${item.raw}`),
    semanticUnderstanding: {
      requests: understanding?.requests || [],
      communication: understanding?.communication || null,
    },
  })

  try {
    const result = await chatCompletion({
      model: models.validation,
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: userPrompt },
      ],
      maxTokens: 450,
      temperature: 0.05,
      task: 'response-validation',
    })

    const data = normalizeValidationData(parseValidationJson(result.text))

    if (!data.safe) {
      return buildFailureResult(
        data.reason || 'Validator could not produce a fully grounded reply',
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
      }, 'Factual validator left unsupported critical numeric values in reply')
      return buildFailureResult(
        'Critical numeric grounding failed after semantic validation',
        postflightUnsupported.map(item => `${item.kind}: ${item.raw}`),
        { needsHuman: true },
      )
    }

    return {
      safe: true,
      approvedReply: data.approvedReply,
      unsupportedClaims: data.unsupportedClaims,
      reason: data.reason,
      needsHuman: data.needsHuman,
      skipped: false,
      failed: false,
      model: result.model,
    }
  } catch (error) {
    logger.error({ error: error?.message }, 'Response validation failed')
    // Fail closed for factual turns, but do not create a CRM handoff solely
    // because a validator provider call malfunctioned. The caller sends a safe
    // fact-free recovery and can offer staff contact without claiming it happened.
    return buildFailureResult(
      'Validation service failed',
      ['Validation unavailable'],
      { needsHuman: false },
    )
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
  },
}
