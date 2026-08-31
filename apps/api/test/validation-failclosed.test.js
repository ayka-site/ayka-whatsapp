const test = require('node:test')
const assert = require('node:assert/strict')

const { _private: gatewayPrivate } = require('../src/services/ai.gateway.service')
const { _private: validationPrivate } = require('../src/services/response.validator.service')
const { _private: receptionistPrivate } = require('../src/services/ai.receptionist.service')

test('json-object structured mode receives an explicit schema instruction', () => {
  const prompt = gatewayPrivate.buildSchemaInstruction('Validate the reply.', {
    type: 'object',
    required: ['safe'],
    properties: { safe: { type: 'boolean' } },
  })

  assert.match(prompt, /Return ONLY one JSON object/)
  assert.match(prompt, /"required":\["safe"\]/)
})

test('validator plain-text JSON is parsed without relying on response_format', () => {
  const parsed = validationPrivate.parseValidationJson(`\n\`\`\`json\n{
    "safe": true,
    "approvedReply": "Verified reply",
    "unsupportedClaims": [],
    "reason": "grounded",
    "needsHuman": false
  }\n\`\`\`\n`)

  assert.equal(parsed.safe, true)
  assert.equal(parsed.approvedReply, 'Verified reply')
  assert.match(validationPrivate.validationOutputContract(), /Return exactly ONE JSON object/i)
})

test('validator payload shape is checked deterministically', () => {
  const normalized = validationPrivate.normalizeValidationData({
    safe: true,
    approvedReply: '  Verified reply  ',
    unsupportedClaims: ['', ' extra claim ', null],
    reason: ' grounded ',
    needsHuman: false,
  })

  assert.equal(normalized.safe, true)
  assert.equal(normalized.approvedReply, 'Verified reply')
  assert.deepEqual(normalized.unsupportedClaims, ['extra claim'])
  assert.equal(normalized.reason, 'grounded')
  assert.equal(normalized.needsHuman, false)

  assert.throws(
    () => validationPrivate.normalizeValidationData({ safe: true, approvedReply: '' }),
    /needsHuman|unsupportedClaims|approvedReply/,
  )
})

test('transient validator failure does not automatically create a CRM handoff', () => {
  const failure = validationPrivate.buildFailureResult(
    'Validation service failed',
    ['Validation unavailable'],
    { needsHuman: false },
  )

  const markers = receptionistPrivate.buildCompatibilityMarkers(
    { confidence: 0.9, memoryUpdates: {}, shouldHandoff: false },
    failure,
  )

  assert.equal(failure.failed, true)
  assert.equal(failure.needsHuman, false)
  assert.deepEqual(markers, [])
})

test('real semantic or validator human need still creates handoff marker', () => {
  assert.deepEqual(
    receptionistPrivate.buildCompatibilityMarkers(
      { confidence: 0.9, memoryUpdates: {}, shouldHandoff: true },
      { needsHuman: false },
    ),
    ['HANDOFF: YES'],
  )

  assert.deepEqual(
    receptionistPrivate.buildCompatibilityMarkers(
      { confidence: 0.9, memoryUpdates: {}, shouldHandoff: false },
      { needsHuman: true },
    ),
    ['HANDOFF: YES'],
  )
})

test('safe recovery forbids unscheduled future promises and fake handoff claims', () => {
  const prompt = receptionistPrivate.safeRecoverySystemPrompt(
    { agentName: 'Riya', organizationName: 'Demo Vidyalaya' },
    { communication: { replyInstruction: 'Use Devanagari script.' } },
  )

  assert.match(prompt, /Do NOT say or imply that you will check and reply later/i)
  assert.match(prompt, /No future action has been scheduled/i)
  assert.match(prompt, /Do NOT imply that a staff handoff has already happened/i)
})
