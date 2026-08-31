const test = require('node:test')
const assert = require('node:assert/strict')

const { _private } = require('../src/services/prompt.evidence.service')

test('compatibility prompt retrieval preserves explicit request ownership', () => {
  const groups = _private.buildPromptSemanticQueryGroups(
    'Please share timing, uniform source and lab availability.',
    {
      requests: [
        { need: 'school opening time', entities: [] },
        { need: 'uniform source', entities: [] },
        { need: 'computer lab availability', entities: [] },
      ],
      retrievalQueries: [
        { requestIndex: 0, query: 'verified school opening time' },
        { requestIndex: 1, query: 'where students obtain the uniform' },
        { requestIndex: 2, query: 'computer lab availability' },
      ],
      shouldHandoff: false,
    },
  )

  assert.equal(groups.length, 3)
  assert.equal(groups[0].requestIndex, 0)
  assert.equal(groups[1].requestIndex, 1)
  assert.equal(groups[2].requestIndex, 2)
  assert.equal(groups[0].variants.some(query => query.includes('verified school opening time')), true)
  assert.equal(groups[1].variants.some(query => query.includes('where students obtain the uniform')), true)
})

test('multiple expansions for one request cannot shift later request context', () => {
  const groups = _private.buildPromptSemanticQueryGroups(
    'three independent parent questions',
    {
      requests: [
        { need: 'hostel availability for child', entities: ['hostel', 'child'] },
        { need: 'hostel food arrangement', entities: ['hostel', 'food'] },
        { need: 'school closing time', entities: ['school', 'closing time'] },
      ],
      retrievalQueries: [
        { requestIndex: 0, query: 'is boarding available' },
        { requestIndex: 0, query: 'can this child stay in boarding' },
        { requestIndex: 1, query: 'hostel meal arrangement' },
        { requestIndex: 2, query: 'when does school close' },
      ],
      shouldHandoff: false,
    },
  )

  assert.equal(groups.length, 3)
  assert.equal(groups[0].variants.length, 3)
  assert.equal(groups[1].variants.length, 2)
  assert.equal(groups[2].variants.length, 2)
  assert.equal(groups[0].variants.every(query => query.includes('Relevant entities: hostel, child')), true)
  assert.equal(groups[1].variants.every(query => query.includes('Relevant entities: hostel, food')), true)
  assert.equal(groups[2].variants.every(query => query.includes('Relevant entities: school, closing time')), true)
})

test('explicit handoff gets an independent contact-grounding action group', () => {
  const groups = _private.buildPromptSemanticQueryGroups(
    'Please ask someone to call me and also share the document requirements.',
    {
      requests: [
        { need: 'admission document requirements', entities: [] },
      ],
      retrievalQueries: [
        { requestIndex: 0, query: 'verified admission document requirements' },
      ],
      shouldHandoff: true,
    },
  )

  assert.equal(groups.length, 2)
  assert.equal(groups[0].requestIndex, 0)
  assert.equal(groups[1].requestIndex, -2)
  assert.equal(groups[1].action, 'handoff')
  assert.match(groups[1].core, /staff contact information/i)
})
