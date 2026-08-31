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
