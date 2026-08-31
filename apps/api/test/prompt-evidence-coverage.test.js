const test = require('node:test')
const assert = require('node:assert/strict')

const { _private } = require('../src/services/prompt.evidence.service')

test('compatibility prompt retrieval preserves separate semantic needs', () => {
  const queries = _private.buildPromptSemanticQueries(
    'Please share timing, uniform source and lab availability.',
    {
      requests: [
        { need: 'school opening time', entities: [] },
        { need: 'uniform source', entities: [] },
        { need: 'computer lab availability', entities: [] },
      ],
      retrievalQueries: [
        'verified school opening time',
        'where students obtain the uniform',
        'computer lab availability',
      ],
      shouldHandoff: false,
    }
  )

  assert.deepEqual(queries, [
    'verified school opening time',
    'where students obtain the uniform',
    'computer lab availability',
  ])
})

test('compatibility prompt retrieval falls back to request needs when expansion count is short', () => {
  const queries = _private.buildPromptSemanticQueries(
    'three independent parent questions',
    {
      requests: [
        { need: 'hostel availability for son', entities: [] },
        { need: 'number of meals per day', entities: [] },
        { need: 'school closing time', entities: [] },
      ],
      retrievalQueries: [
        'boys hostel availability',
        'daily hostel meal frequency',
      ],
      shouldHandoff: false,
    }
  )

  assert.deepEqual(queries, [
    'hostel availability for son',
    'number of meals per day',
    'school closing time',
  ])
})

test('compatibility prompt retrieval ignores extra expansions rather than shifting entities', () => {
  const queries = _private.buildPromptSemanticQueries(
    'three independent parent questions',
    {
      requests: [
        { need: 'hostel availability for child', entities: ['hostel', 'child'] },
        { need: 'hostel food arrangement', entities: ['hostel', 'food'] },
        { need: 'school closing time', entities: ['school', 'closing time'] },
      ],
      retrievalQueries: [
        'is boarding available',
        'can this student stay in boarding',
        'what meals are served',
        'when does school close',
      ],
      shouldHandoff: false,
    }
  )

  assert.equal(queries.length, 3)
  assert.match(queries[0], /^hostel availability for child/)
  assert.match(queries[0], /Relevant entities: hostel, child/)
  assert.match(queries[1], /^hostel food arrangement/)
  assert.match(queries[1], /Relevant entities: hostel, food/)
  assert.match(queries[2], /^school closing time/)
  assert.match(queries[2], /Relevant entities: school, closing time/)
})

test('explicit handoff adds one contact grounding query without collapsing other needs', () => {
  const queries = _private.buildPromptSemanticQueries(
    'Please ask someone to call me and also share the document requirements.',
    {
      requests: [
        { need: 'admission document requirements', entities: [] },
      ],
      retrievalQueries: ['verified admission document requirements'],
      shouldHandoff: true,
    }
  )

  assert.equal(queries[0], 'verified admission document requirements')
  assert.equal(queries.includes('school staff contact information and contact hours'), true)
  assert.equal(queries.length, 2)
})
