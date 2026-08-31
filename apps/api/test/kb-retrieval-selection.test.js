const test = require('node:test')
const assert = require('node:assert/strict')

const { _private: retrieval } = require('../src/services/kb.retrieval.service')

test('each semantic request owns its core retrieval group and mapped expansions', () => {
  const groups = retrieval.buildSemanticQueryGroups({
    message: 'three things please',
    understanding: {
      requests: [
        { need: 'opening time', entities: ['Class 4'] },
        { need: 'uniform source', entities: [] },
        { need: 'computer lab availability', entities: [] },
      ],
      retrievalQueries: [
        { requestIndex: 0, query: 'verified weekday opening time' },
        { requestIndex: 0, query: 'school start time' },
        { requestIndex: 1, query: 'where students obtain uniform' },
        { requestIndex: 2, query: 'computer laboratory availability' },
      ],
    },
    session: { flowState: { collectedData: { interestedClass: 'Class 4' } } },
  })

  assert.equal(groups.length, 3)
  assert.match(groups[0].core, /^opening time/)
  assert.match(groups[0].core, /Relevant entities: Class 4/)
  assert.equal(groups[0].variants.length, 3)
  assert.match(groups[0].variants[1], /verified weekday opening time/)
  assert.match(groups[1].variants[1], /where students obtain uniform/)
  assert.match(groups[2].variants[1], /computer laboratory availability/)
  assert.equal(groups.every(group => group.variants.every(query => query.includes('Target admission class: Class 4'))), true)
})

test('extra expansions cannot shift another requests entity context', () => {
  const groups = retrieval.buildSemanticQueryGroups({
    message: 'three parent needs',
    understanding: {
      requests: [
        { need: 'hostel availability for child', entities: ['hostel', 'child'] },
        { need: 'hostel food arrangement', entities: ['hostel', 'food'] },
        { need: 'school closing time', entities: ['school', 'closing time'] },
      ],
      retrievalQueries: [
        { requestIndex: 0, query: 'is boarding available' },
        { requestIndex: 0, query: 'can the child stay in boarding' },
        { requestIndex: 1, query: 'hostel meal arrangement' },
        { requestIndex: 2, query: 'when does school close' },
      ],
    },
    session: { flowState: { collectedData: {} } },
  })

  assert.equal(groups.length, 3)
  assert.equal(groups[0].variants.length, 3)
  assert.equal(groups[1].variants.length, 2)
  assert.equal(groups[2].variants.length, 2)
  assert.equal(groups[0].variants.every(query => query.includes('Relevant entities: hostel, child')), true)
  assert.equal(groups[1].variants.every(query => query.includes('Relevant entities: hostel, food')), true)
  assert.equal(groups[2].variants.every(query => query.includes('Relevant entities: school, closing time')), true)
})

test('invalid mapped expansions are ignored without reducing core request coverage', () => {
  const groups = retrieval.buildSemanticQueryGroups({
    message: 'question',
    understanding: {
      requests: [
        { need: 'fee for target class', entities: ['Class 6'] },
        { need: 'school address', entities: [] },
      ],
      retrievalQueries: [
        { requestIndex: 99, query: 'invalid expansion' },
        { requestIndex: 0, query: 'class fee structure' },
      ],
    },
    session: { flowState: { collectedData: {} } },
  })

  assert.equal(groups.length, 2)
  assert.match(groups[0].core, /^fee for target class/)
  assert.match(groups[1].core, /^school address/)
  assert.equal(groups[0].variants.some(query => query.includes('class fee structure')), true)
  assert.equal(groups.some(group => group.variants.some(query => query.includes('invalid expansion'))), false)
})

test('core request semantics dominate an over-specific expansion', () => {
  const groups = [{
    requestIndex: 0,
    core: 'hostel availability',
    variants: ['hostel availability', 'hostel eligibility conditions'],
  }]
  const flattened = retrieval.flattenQueryGroups(groups)
  const chunks = [
    { id: 'availability', text: 'boys hostel is available', embedding: [0.98, 0.2] },
    { id: 'eligibility', text: 'eligibility conditions', embedding: [0.4, 0.92] },
  ]
  const vectors = [[1, 0], [0, 1]]

  const scored = retrieval.scoreChunksAgainstGroups(chunks, groups, vectors, flattened.variantRefs)
  const availability = scored.find(item => item.id === 'availability')
  const eligibility = scored.find(item => item.id === 'eligibility')

  assert.equal(availability.groupScores[0] > eligibility.groupScores[0], true)
})

test('coverage retrieval selects one strongest chunk per request and never pads topK', () => {
  const groups = [
    { requestIndex: 0, core: 'opening', variants: ['opening'] },
    { requestIndex: 1, core: 'uniform', variants: ['uniform'] },
    { requestIndex: 2, core: 'lab', variants: ['lab'] },
  ]
  const scored = [
    { id: 'timing', text: 'opening time', groupScores: [0.91, 0.12, 0.08] },
    { id: 'uniform', text: 'uniform source', groupScores: [0.13, 0.87, 0.11] },
    { id: 'lab', text: 'computer lab', groupScores: [0.11, 0.09, 0.82] },
    { id: 'library', text: 'library', groupScores: [0.31, 0.26, 0.39] },
    { id: 'hostel', text: 'hostel', groupScores: [0.29, 0.22, 0.25] },
  ]

  const selected = retrieval.selectEvidenceForGroups(scored, groups, {
    topK: 8,
    minimumScore: 0.18,
    maxChars: 6500,
    supportPerGroup: 0,
  })

  assert.deepEqual(selected.map(item => item.id), ['timing', 'uniform', 'lab'])
  assert.equal(selected.some(item => item.id === 'library'), false)
  assert.equal(selected.some(item => item.id === 'hostel'), false)
})

test('one evidence chunk may satisfy more than one request group without duplication', () => {
  const groups = [
    { requestIndex: 0, core: 'admission availability', variants: ['admission availability'] },
    { requestIndex: 1, core: 'admission process', variants: ['admission process'] },
  ]
  const scored = [
    { id: 'admission-overview', text: 'admission overview', groupScores: [0.88, 0.84] },
    { id: 'sports', text: 'sports', groupScores: [0.25, 0.28] },
  ]

  const selected = retrieval.selectEvidenceForGroups(scored, groups, {
    topK: 8,
    minimumScore: 0.18,
    maxChars: 6500,
    supportPerGroup: 0,
  })

  assert.equal(selected.length, 1)
  assert.equal(selected[0].id, 'admission-overview')
  assert.deepEqual(selected[0].matchedGroupIndexes, [0, 1])
})
