/**
 * Lead Scoring Engine - Unit Tests
 * Tests the pure scoring function across both verticals + generic fallback
 */
const { computeLeadScore } = require('../src/core/scoring.engine')

let pass = 0, fail = 0, total = 0

function test(label, flowState, vertical, expectedScore) {
  total++
  const { score, reason } = computeLeadScore(flowState, vertical)
  if (score === expectedScore) {
    pass++
    console.log(`  ✅  ${label}  →  ${score} ("${reason}")`)
  } else {
    fail++
    console.log(`  ❌  ${label}  →  got ${score}, want ${expectedScore} ("${reason}")`)
  }
}

// ═══════════════════════════════════════════════════════
// 1. School vertical
// ═══════════════════════════════════════════════════════
console.log('\n── School: cold cases ─────────────────────────────────')
test('null flowState',
  null, 'school', 'cold')
test('empty flowState',
  { collectedData: {}, goals: {} }, 'school', 'cold')
test('only parent name',
  { collectedData: { parentName: 'Rajesh' }, goals: {} }, 'school', 'cold')
test('parent + class but no student',
  { collectedData: { parentName: 'Rajesh', interestedClass: 'Class 6' }, goals: {} }, 'school', 'cold')

console.log('\n── School: warm cases ─────────────────────────────────')
test('parent + student + class = warm',
  { collectedData: { parentName: 'Rajesh', studentName: 'Arjun', interestedClass: 'Class 6' }, goals: {} },
  'school', 'warm')
test('all three + extras still warm (not hot without visit/handoff)',
  { collectedData: { parentName: 'Rajesh', studentName: 'Arjun', interestedClass: 'Class 6', altPhone: '9876543210' }, goals: {} },
  'school', 'warm')

console.log('\n── School: hot cases ──────────────────────────────────')
test('visit time captured = hot',
  { collectedData: { preferredVisitTime: 'tomorrow' }, goals: {} },
  'school', 'hot')
test('handoff triggered = hot',
  { collectedData: {}, goals: {}, handoffTriggered: true },
  'school', 'hot')
test('visit + handoff = hot (both reasons)',
  { collectedData: { preferredVisitTime: 'Saturday' }, goals: {}, handoffTriggered: true },
  'school', 'hot')
test('full data + visit = hot',
  { collectedData: { parentName: 'Rajesh', studentName: 'Arjun', interestedClass: 'Class 6', preferredVisitTime: 'kal' }, goals: {} },
  'school', 'hot')

// ═══════════════════════════════════════════════════════
// 2. Real estate vertical
// ═══════════════════════════════════════════════════════
console.log('\n── RealEstate: cold cases ─────────────────────────────')
test('no data',
  { collectedData: {}, goals: {} }, 'realestate', 'cold')
test('only buyer name',
  { collectedData: { buyerName: 'Amit' }, goals: {} }, 'realestate', 'cold')
test('low budget long timeline',
  { collectedData: { budget: '30 lakhs', timeline: '6 months' }, goals: {} }, 'realestate', 'cold')

console.log('\n── RealEstate: warm cases ─────────────────────────────')
test('high budget no timeline',
  { collectedData: { budget: '65 lakhs' }, goals: {} }, 'realestate', 'warm')
test('high budget long timeline',
  { collectedData: { budget: '1.2 crore', timeline: '8 months' }, goals: {} }, 'realestate', 'warm')
test('low budget short timeline',
  { collectedData: { budget: '40L', timeline: '2 months' }, goals: {} }, 'realestate', 'warm')
test('no budget short timeline',
  { collectedData: { timeline: '1 month' }, goals: {} }, 'realestate', 'warm')

console.log('\n── RealEstate: hot cases ──────────────────────────────')
test('high budget short timeline = hot',
  { collectedData: { budget: '65 lakhs', timeline: '2 months' }, goals: {} }, 'realestate', 'hot')
test('crore budget 3mo = hot',
  { collectedData: { budget: '1.5 crore', timeline: '3 months' }, goals: {} }, 'realestate', 'hot')
test('handoff = hot',
  { collectedData: {}, goals: {}, handoffTriggered: true }, 'realestate', 'hot')

// ═══════════════════════════════════════════════════════
// 3. Unknown vertical (generic fallback)
// ═══════════════════════════════════════════════════════
console.log('\n── Generic fallback (unknown vertical) ────────────────')
test('no data = cold',
  { collectedData: {}, goals: {} }, 'healthcare', 'cold')
test('1 field = cold',
  { collectedData: { parentName: 'Amit' }, goals: {} }, 'healthcare', 'cold')
test('2 fields = warm',
  { collectedData: { parentName: 'Amit', interestedClass: 'Class 5' }, goals: {} }, 'healthcare', 'warm')
test('visit time = hot',
  { collectedData: { preferredVisitTime: 'tomorrow' }, goals: {} }, 'healthcare', 'hot')
test('handoff = hot',
  { collectedData: {}, goals: {}, handoffTriggered: true }, 'healthcare', 'hot')

// ═══════════════════════════════════════════════════════
// 4. Edge cases - budget/timeline parsing (realestate)
// ═══════════════════════════════════════════════════════
console.log('\n── RealEstate: budget/timeline parsing edge cases ─────')
test('budget "80,00,000" = 80L → hot with 1mo',
  { collectedData: { budget: '80,00,000', timeline: '1 month' }, goals: {} }, 'realestate', 'hot')
test('budget "6500000" = 65L → hot with immediately',
  { collectedData: { budget: '6500000', timeline: 'immediately' }, goals: {} }, 'realestate', 'hot')
test('timeline "next month" = 1mo → warm with no budget',
  { collectedData: { timeline: 'next month' }, goals: {} }, 'realestate', 'warm')
test('timeline "1 year" = 12mo → cold with 30L budget',
  { collectedData: { budget: '30 lakhs', timeline: '1 year' }, goals: {} }, 'realestate', 'cold')

// ═══════════════════════════════════════════════════════
console.log(`\n${'═'.repeat(55)}`)
console.log(`  TOTAL: ${total}  |  ✅ PASS: ${pass}  |  ❌ FAIL: ${fail}`)
console.log(`${'═'.repeat(55)}\n`)

process.exit(fail > 0 ? 1 : 0)
