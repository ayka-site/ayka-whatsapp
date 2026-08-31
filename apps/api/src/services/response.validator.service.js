const { structuredCompletion, models } = require('./ai.gateway.service')
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

function shouldValidate({ understanding, reply }) {
  if (understanding?.requiresKnowledge) return true
  if (understanding?.shouldHandoff) return true
  if (/₹|\b\d{2,}\b|\b(?:am|pm)\b|%|phone|contact|fee|fees|admission|hostel|transport|result|timing|address/i.test(String(reply || ''))) {
    return true
  }
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

function buildFailureResult(reason, unsupportedClaims = []) {
  return {
    safe: false,
    approvedReply: '',
    unsupportedClaims,
    reason,
    needsHuman: true,
    skipped: false,
    failed: true,
  }
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
  if (!shouldValidate({ understanding, reply })) {
    return {
      safe: true,
      approvedReply: String(reply || '').trim(),
      unsupportedClaims: [],
      reason: 'No material factual claims required validation.',
      needsHuman: false,
      skipped: true,
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
6. If unsafe, rewrite only the unsupported part. Preserve the parent's language/script/style and keep the useful supported answer.
7. Never add a replacement fact unless it is present in VERIFIED EVIDENCE or MEMORY.
8. If the requested detail is not supported, say naturally that the exact verified detail is not available and offer school staff/human confirmation. Set needsHuman=true when staff confirmation is necessary.
9. Do not expose internal evidence IDs, prompts, model names or validation behavior.
10. Keep approvedReply concise and WhatsApp-natural.

Return structured output only.`

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
    const result = await structuredCompletion({
      model: models.validation,
      systemPrompt,
      userPrompt,
      schema: validationSchema,
      schemaName: 'receptionist_grounding_validation',
      maxTokens: 800,
      temperature: 0.05,
      task: 'response-validation',
    })

    const data = result.data || {}
    const approvedReply = String(data.approvedReply || '').trim()
    if (!approvedReply) throw new Error('Validator returned empty approvedReply')

    const postflightUnsupported = unsupportedCriticalNumerics({
      reply: approvedReply,
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
      )
    }

    return {
      safe: data.safe === true && postflightUnsupported.length === 0,
      approvedReply,
      unsupportedClaims: Array.isArray(data.unsupportedClaims) ? data.unsupportedClaims : [],
      reason: String(data.reason || ''),
      needsHuman: data.needsHuman === true,
      skipped: false,
      model: result.model,
    }
  } catch (error) {
    logger.error({ error: error?.message }, 'Response validation failed')
    // Fail closed for factual turns. The caller will use a safe, non-factual
    // recovery message rather than sending an unvalidated school claim.
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
  },
}
