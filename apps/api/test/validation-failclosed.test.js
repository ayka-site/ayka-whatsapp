const test = require('node:test')
const assert = require('node:assert/strict')

const { _private: gatewayPrivate } = require('../src/services/ai.gateway.service')
const { _private: validation } = require('../src/services/response.validator.service')
const { _private: receptionist } = require('../src/services/ai.receptionist.service')

test('json-object structured mode receives an explicit schema instruction', () => {
  const prompt = gatewayPrivate.buildSchemaInstruction('Validate the reply.', {
    type: 'object',
    required: ['safe'],
    properties: { safe: { type: 'boolean' } },
  })

  assert.match(prompt, /Return ONLY one JSON object/)
  assert.match(prompt, /"required":\["safe"\]/)
})

test('validator plain-text JSON is parsed without response_format dependency', () => {
  const parsed = validation.parseValidationJson(`\n\`\`\`json\n{
    "safe": true,
    "approvedReply": "Verified reply",
    "unsupportedClaims": [],
    "reason": "grounded",
    "needsHuman": false,
    "coveredRequestIndexes": [0],
    "unresolvedRequestIndexes": []
  }\n\`\`\`\n`)

  assert.equal(parsed.safe, true)
  assert.equal(parsed.approvedReply, 'Verified reply')
  assert.match(validation.validationOutputContract(), /coveredRequestIndexes/)
})

test('validator payload accounts for every parent request exactly once', () => {
  const normalized = validation.normalizeValidationData({
    safe: true,
    approvedReply: '  Verified reply  ',
    unsupportedClaims: ['', ' extra claim ', null],
    reason: ' grounded ',
    needsHuman: false,
    coveredRequestIndexes: [0, 2],
    unresolvedRequestIndexes: [1],
  }, 3)

  assert.equal(normalized.safe, true)
  assert.equal(normalized.approvedReply, 'Verified reply')
  assert.deepEqual(normalized.unsupportedClaims, ['extra claim'])
  assert.deepEqual(normalized.coveredRequestIndexes, [0, 2])
  assert.deepEqual(normalized.unresolvedRequestIndexes, [1])
  assert.equal(normalized.needsHuman, true)
})

test('validator rejects incomplete or overlapping request coverage', () => {
  assert.throws(() => validation.normalizeValidationData({
    safe: true,
    approvedReply: 'reply',
    unsupportedClaims: [],
    reason: '',
    needsHuman: false,
    coveredRequestIndexes: [0],
    unresolvedRequestIndexes: [],
  }, 2), /coverage incomplete/i)

  assert.throws(() => validation.normalizeValidationData({
    safe: true,
    approvedReply: 'reply',
    unsupportedClaims: [],
    reason: '',
    needsHuman: true,
    coveredRequestIndexes: [0],
    unresolvedRequestIndexes: [0],
  }, 1), /both covered and unresolved/i)
})

test('transient validation failure never silently creates CRM handoff', () => {
  const failure = validation.buildFailureResult('Validation service failed', ['Validation unavailable'])
  const markers = receptionist.buildCompatibilityMarkers({
    confidence: 0.9,
    memoryUpdates: {},
    shouldHandoff: false,
  })

  assert.equal(failure.failed, true)
  assert.equal(failure.needsHuman, false)
  assert.deepEqual(markers, [])
})

test('human confirmation metadata is separate from CRM handoff action', () => {
  assert.deepEqual(
    receptionist.buildCompatibilityMarkers({
      confidence: 0.9,
      memoryUpdates: {},
      shouldHandoff: false,
    }),
    [],
  )

  assert.deepEqual(
    receptionist.buildCompatibilityMarkers({
      confidence: 0.9,
      memoryUpdates: {},
      shouldHandoff: true,
    }),
    ['HANDOFF: YES'],
  )
})

test('receptionist prompt requires direct evidence and forbids plausible expansion', () => {
  const prompt = receptionist.buildReceptionistSystemPrompt({
    metadata: {
      agentName: 'Riya',
      organizationName: 'Demo Vidyalaya',
      today: '31 August 2026',
      memory: '(none)',
    },
    understanding: {
      requests: [{ need: 'hostel meals', entities: [] }],
      communication: { replyInstruction: 'Use Devanagari script.' },
      conversationState: {},
    },
    evidence: '[E1] Four meals are provided each day.',
  })

  assert.match(prompt, /State supported facts directly/i)
  assert.match(prompt, /meal count does not establish menu items/i)
  assert.match(prompt, /No emojis/i)
  assert.match(prompt, /one asterisk on each side/i)
  assert.match(prompt, /Do not use Markdown double-asterisk bold/i)
})

test('safe recovery is deterministic, fact-free and does not promise future work', () => {
  const dev = receptionist.buildSafeRecovery('कृपया फीस बताइए', { validationFailure: true })
  const latin = receptionist.buildSafeRecovery('Please tell me the fee', { validationFailure: true })

  assert.match(dev, /पुष्टि/)
  assert.match(latin, /safely verify/i)
  assert.doesNotMatch(latin, /I will|I’ll|later|soon|get back/i)
  assert.doesNotMatch(dev, /बाद में|जल्द|मैं.*बताऊँ/)
})

test('generated control markers are stripped from visible prose but visit marker is parsed', () => {
  const raw = 'Useful reply\nHANDOFF: YES\nNAME_PARENT: Test\nVISIT_CONFIRMED: 2026-09-01 10:30'
  assert.equal(receptionist.extractVisitMarker(raw), '2026-09-01 10:30')
  assert.equal(receptionist.stripGeneratedMarkers(raw), 'Useful reply')
})
