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

test('historical plain-text validator JSON remains parseable for compatibility', () => {
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
  assert.deepEqual(validation.validationSchema.required.includes('approvedReply'), true)
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

test('normal semantic handoff remains an explicit CRM action', () => {
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

test('fail-closed parent copy performs the handoff it promises', () => {
  const latin = receptionist.buildFailClosedHandoff('Please tell me the fee')
  const dev = receptionist.buildFailClosedHandoff('कृपया फीस बताइए')

  assert.match(latin, /connecting you with/i)
  assert.match(dev, /कनेक्ट कर रही हूँ/)
  assert.match(latin, /\nHANDOFF: YES$/)
  assert.match(dev, /\nHANDOFF: YES$/)
  assert.doesNotMatch(latin, /please call|contact the school/i)
})

test('any unresolved parent request now triggers a real admissions handoff', () => {
  assert.equal(receptionist.validationNeedsHandoff({
    safe: true,
    failed: false,
    needsHuman: true,
    unresolvedRequestIndexes: [0],
  }), true)

  assert.equal(receptionist.validationNeedsHandoff({
    safe: true,
    failed: false,
    needsHuman: false,
    unresolvedRequestIndexes: [],
  }), false)

  const devNotice = receptionist.buildHandoffNotice('हॉस्टल की जानकारी बताइए', {
    communication: { languageStyle: 'Hindi' },
  })
  const hinglishNotice = receptionist.buildHandoffNotice('Hostel ka exact scene kya hai?', {
    communication: { languageStyle: 'Roman Hindi / Hinglish' },
  })

  assert.match(devNotice, /कनेक्ट कर रही हूँ/)
  assert.match(hinglishNotice, /connect kar rahi hoon/i)
  assert.doesNotMatch(devNotice, /contact|call/i)
})

test('lead context progresses from cold to warm to hot without message-count rules', () => {
  const cold = receptionist.buildLeadContext({ memory: '' }, {
    requests: [{ need: 'fees' }],
    memoryUpdates: {},
    conversationState: { salesReadiness: 'unknown', stage: 'initial_inquiry' },
    shouldHandoff: false,
  })
  assert.equal(cold.temperature, 'cold')
  assert.equal(cold.nextMissingField, 'target admission class')

  const warm = receptionist.buildLeadContext({ memory: '' }, {
    requests: [{ need: 'Class 6 fees' }],
    memoryUpdates: { interestedClass: 'Class 6' },
    conversationState: { salesReadiness: 'medium', stage: 'information_gathering' },
    shouldHandoff: false,
  })
  assert.equal(warm.temperature, 'warm')
  assert.equal(warm.nextMissingField, "student's name")

  const hot = receptionist.buildLeadContext({ memory: 'Class interested: Class 6' }, {
    requests: [{ need: 'speak to admissions' }],
    memoryUpdates: {},
    conversationState: { salesReadiness: 'high', stage: 'handoff' },
    shouldHandoff: true,
  })
  assert.equal(hot.temperature, 'hot')
})

test('receptionist prompt answers first, qualifies once and handles real handoff naturally', () => {
  const prompt = receptionist.buildReceptionistSystemPrompt({
    metadata: {
      agentName: 'Riya',
      organizationName: 'Demo Vidyalaya',
      today: '31 August 2026',
      memory: '(none)',
    },
    understanding: {
      requests: [{ need: 'hostel meals', entities: [] }],
      memoryUpdates: {},
      communication: { replyInstruction: 'Use Devanagari script.' },
      conversationState: { salesReadiness: 'medium', stage: 'information_gathering' },
      shouldHandoff: false,
    },
    evidence: '[E1] Four meals are provided each day.',
  })

  assert.match(prompt, /Answer the parent's actual question first/i)
  assert.match(prompt, /ask at most ONE short natural question/i)
  assert.match(prompt, /offer to help schedule a school visit/i)
  assert.match(prompt, /being connected|connecting the parent|connect the parent/i)
  assert.match(prompt, /State supported facts directly/i)
  assert.match(prompt, /meal count does not establish menu items/i)
  assert.match(prompt, /No emojis/i)
  assert.match(prompt, /one asterisk on each side/i)
  assert.match(prompt, /Do not use Markdown double-asterisk bold/i)
})

test('generated control markers are stripped from visible prose but visit marker is parsed', () => {
  const raw = 'Useful reply\nHANDOFF: YES\nNAME_PARENT: Test\nVISIT_CONFIRMED: 2026-09-01 10:30'
  assert.equal(receptionist.extractVisitMarker(raw), '2026-09-01 10:30')
  assert.equal(receptionist.stripGeneratedMarkers(raw), 'Useful reply')
})
