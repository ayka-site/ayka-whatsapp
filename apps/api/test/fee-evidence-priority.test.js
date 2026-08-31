const test = require('node:test')
const assert = require('node:assert/strict')

const { extractEvidenceChunks } = require('../src/services/prompt.evidence.service')

function promptWithKnownFacts(lines) {
  return `━━━ KNOWN FACTS (say ONLY what is here - never invent) ━━━\n${lines.join('\n')}\n\n━━━ 7 RULES (follow in exact priority order) ━━━\n1. Answer from verified facts.`
}

test('structured class-wise fees suppress legacy simplified monthly totals', () => {
  const prompt = promptWithKnownFacts([
    '• Fees (2026-27, class-wise):\nVI: ₹1800/month tuition + ₹3000 additional + ₹1000 annual',
    '• Fees (SIMPLE TOTALS for parents - use only if class-wise table is missing):\nClass 6: ₹1800/month tuition + ₹3000 additional + ₹1000 annual = lagbhag ₹2150/month',
    '• Fee Note: Additional fee aur annual fee ek baar deni hoti hai, monthly nahi.',
    '• School hours: Summer: 8:00 AM – 1:30 PM; Winter: 9:00 AM – 2:30 PM',
  ])

  const chunks = extractEvidenceChunks(prompt)
  const text = chunks.map(chunk => chunk.text).join('\n')

  assert.match(text, /Fees \(2026-27, class-wise\)/)
  assert.match(text, /₹1800\/month tuition/)
  assert.doesNotMatch(text, /SIMPLE TOTALS/i)
  assert.doesNotMatch(text, /₹2150\/month/i)
  assert.doesNotMatch(text, /Fee Note:/i)
  assert.match(text, /School hours:/i)
})

test('legacy simplified fees remain available when no structured class-wise fees exist', () => {
  const prompt = promptWithKnownFacts([
    '• Fees (SIMPLE TOTALS for parents - use only if class-wise table is missing):\nClass 6: ₹2150/month',
    '• Fee Note: Legacy fee summary.',
  ])

  const chunks = extractEvidenceChunks(prompt)
  const text = chunks.map(chunk => chunk.text).join('\n')

  assert.match(text, /SIMPLE TOTALS/i)
  assert.match(text, /₹2150\/month/i)
  assert.match(text, /Fee Note:/i)
})
