const test = require('node:test')
const assert = require('node:assert/strict')

const { shouldValidate } = require('../src/services/response.validator.service')

test('validation trigger uses semantic state/evidence rather than topic keywords', () => {
  assert.equal(shouldValidate({
    understanding: { requiresKnowledge: true, shouldHandoff: false },
    reply: 'A completely ordinary sentence.',
    evidence: '',
  }), true)

  assert.equal(shouldValidate({
    understanding: { requiresKnowledge: false, shouldHandoff: false },
    reply: 'Hostel admission transport fees timing address',
    evidence: '',
  }), false)

  assert.equal(shouldValidate({
    understanding: { requiresKnowledge: false, shouldHandoff: false },
    reply: 'A supported factual sentence.',
    evidence: '[E1] Verified school evidence.',
  }), true)
})

test('critical numeric claims remain a deterministic validation backstop', () => {
  assert.equal(shouldValidate({
    understanding: { requiresKnowledge: false, shouldHandoff: false },
    reply: 'The amount is ₹1800.',
    evidence: '',
  }), true)

  assert.equal(shouldValidate({
    understanding: { requiresKnowledge: false, shouldHandoff: false },
    reply: 'Thanks!',
    evidence: '',
  }), false)
})
