const test = require('node:test')
const assert = require('node:assert/strict')

const { _private: retrievalPrivate } = require('../src/services/kb.retrieval.service')

test('semantic retrieval keeps distinct model-planned queries separate', () => {
  const queries = retrievalPrivate.buildSemanticQueries({
    message: 'तीन अलग चीज़ों की जानकारी चाहिए',
    understanding: {
      retrievalQueries: [
        'verified weekday opening time',
        'where the required uniform can be obtained',
        'computer lab availability',
      ],
      requests: [
        { need: 'opening time', entities: ['Class 4'] },
        { need: 'uniform source', entities: [] },
        { need: 'computer lab', entities: [] },
      ],
    },
    session: {
      flowState: {
        collectedData: { interestedClass: 'Class 4' },
      },
    },
  })

  assert.equal(queries.length, 3)
  assert.match(queries[0], /verified weekday opening time/)
  assert.match(queries[0], /Relevant entities: Class 4/)
  assert.equal(queries.every(query => query.includes('Target admission class: Class 4')), true)
  assert.equal(queries.some(query => query.includes('तीन अलग चीज़ों')), false)
})

test('coverage retrieval does not pad top-K with unrelated school facts', () => {
  const scored = [
    {
      id: 'timing',
      path: 'school.timings.opening',
      text: 'opening time',
      queryScores: [0.91, 0.12, 0.08],
      score: 0.91,
    },
    {
      id: 'uniform',
      path: 'school.uniform.source',
      text: 'uniform source',
      queryScores: [0.13, 0.87, 0.11],
      score: 0.87,
    },
    {
      id: 'lab',
      path: 'school.facilities.computerLab',
      text: 'computer lab',
      queryScores: [0.11, 0.09, 0.82],
      score: 0.82,
    },
    {
      id: 'library',
      path: 'school.facilities.library',
      text: 'library',
      queryScores: [0.31, 0.26, 0.39],
      score: 0.39,
    },
    {
      id: 'hostel',
      path: 'school.hostel.availability',
      text: 'hostel',
      queryScores: [0.29, 0.22, 0.25],
      score: 0.29,
    },
  ]

  const selected = retrievalPrivate.selectEvidenceForQueries(scored, 3, {
    topK: 8,
    minimumScore: 0.18,
    maxChars: 6500,
    supportPerQuery: 0,
  })

  assert.deepEqual(selected.map(item => item.id), ['timing', 'uniform', 'lab'])
  assert.equal(selected.some(item => item.id === 'library'), false)
  assert.equal(selected.some(item => item.id === 'hostel'), false)
})

test('one evidence chunk may safely satisfy more than one semantic query', () => {
  const scored = [
    {
      id: 'admission-overview',
      path: 'school.admission.overview',
      text: 'admission overview',
      queryScores: [0.88, 0.84],
      score: 0.88,
    },
    {
      id: 'unrelated',
      path: 'school.sports.overview',
      text: 'sports',
      queryScores: [0.25, 0.28],
      score: 0.28,
    },
  ]

  const selected = retrievalPrivate.selectEvidenceForQueries(scored, 2, {
    topK: 8,
    minimumScore: 0.18,
    maxChars: 6500,
    supportPerQuery: 0,
  })

  assert.equal(selected.length, 1)
  assert.equal(selected[0].id, 'admission-overview')
  assert.deepEqual(selected[0].matchedQueryIndexes, [0, 1])
})
