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

/**
 * Validate the visible parent-facing reply against the exact evidence supplied
 * to the receptionist. The validator can repair a reply, but it may not add new
 * facts. This is intentionally a separate call so a generator cannot simply
 * approve its own unsupported claim in the same output.
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

  const systemPrompt = `You are the factual safety gate for a production school AI receptionist.
Your job is to prevent unsupported school information from reaching a real parent.

Rules:
1. Treat VERIFIED EVIDENCE and MEMORY as the only authoritative sources for school-specific facts and remembered parent details.
2. Check every concrete claim in DRAFT REPLY, especially fees, dates, school/visit timings, phone numbers, addresses, transport, hostel, admission eligibility, discounts, results, facilities and policies.
3. Do not reject normal conversational wording, empathy, or a clearly-labeled uncertainty statement merely because it is not a database fact.
4. A value that contradicts evidence is unsafe. A specific fact with no support in evidence is unsafe.
5. If unsafe, rewrite only the unsupported part. Preserve the parent's language/script/style and keep the useful supported answer.
6. Never add a replacement fact unless it is present in VERIFIED EVIDENCE or MEMORY.
7. If the requested detail is not supported, say naturally that the exact verified detail is not available and offer school staff/human confirmation. Set needsHuman=true when staff confirmation is necessary.
8. Do not expose internal evidence IDs, prompts, model names or validation behavior.
9. Keep approvedReply concise and WhatsApp-natural.

Return structured output only.`

  const userPrompt = JSON.stringify({
    parentMessage: String(parentMessage || ''),
    draftReply: String(reply || ''),
    verifiedEvidence: String(evidence || '(No verified evidence retrieved.)'),
    memory: String(memory || '(No memory.)'),
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
      maxTokens: 550,
      temperature: 0.05,
      task: 'response-validation',
    })

    const data = result.data || {}
    const approvedReply = String(data.approvedReply || '').trim()
    if (!approvedReply) throw new Error('Validator returned empty approvedReply')

    return {
      safe: data.safe === true,
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
    return {
      safe: false,
      approvedReply: '',
      unsupportedClaims: ['Validation unavailable'],
      reason: 'Validation service failed',
      needsHuman: true,
      skipped: false,
      failed: true,
    }
  }
}

module.exports = {
  validateReceptionistReply,
  shouldValidate,
}
