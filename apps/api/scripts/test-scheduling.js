/**
 * Visit Scheduling — Feature Test Suite
 *
 * Tests:
 *   1. parseAIResponse: VISIT_CONFIRMED: YES detection
 *   2. parseAIResponse: VISIT_CONFIRMED injection resistance
 *   3. Scoring: visitConfirmed → hot
 *   4. Scoring: preferredVisitTime still → hot
 *   5. Scheduling config: school enabled, realestate disabled
 *   6. Prompt builder: RULE 6B present when scheduling enabled
 *   7. Prompt builder: visit scheduling disabled message when scheduling off
 *   8. Session flowState: visitConfirmed defaults to false
 *   9. VISIT_CONFIRMED + HANDOFF coexistence in same response
 */
const flow = require('../src/core/flow.engine')
const { computeLeadScore } = require('../src/core/scoring.engine')
const { isSchedulingEnabled } = require('../src/core/scheduling.engine')
const { buildSystemPrompt } = require('../src/core/prompt.builder')

let pass = 0, fail = 0, total = 0

function test(label, actual, expected) {
  total++
  if (actual === expected) {
    pass++
    console.log(`  ✅  ${label}`)
  } else {
    fail++
    console.log(`  ❌  ${label}`)
    console.log(`       got="${actual}"  want="${expected}"`)
  }
}

// ════════════════════════════════════════════════════════
// 1. parseAIResponse — VISIT_CONFIRMED detection
// ════════════════════════════════════════════════════════
console.log('\n── 1. parseAIResponse — VISIT_CONFIRMED detection ──')

const baseFlow = { collectedData: {}, goals: {}, handoffTriggered: false }

// Basic detection
const r1 = flow.parseAIResponse('Your visit is confirmed for Tuesday.\nVISIT_CONFIRMED: YES', { ...baseFlow })
test('Detects VISIT_CONFIRMED: YES', r1.visitConfirmed, true)
test('Strips signal from response', r1.cleanResponse.includes('VISIT_CONFIRMED'), false)
test('Sets visitConfirmed on flowState', r1.updatedFlowState.visitConfirmed, true)
test('Does NOT trigger handoff', r1.shouldHandoff, false)

// Case-insensitive
const r2 = flow.parseAIResponse('Visit confirmed.\nvisit_confirmed: yes', { ...baseFlow })
test('Case-insensitive detection', r2.visitConfirmed, true)

// Not triggered when absent
const r3 = flow.parseAIResponse('Sure, when would you like to visit?', { ...baseFlow })
test('No false positive on visit mention', r3.visitConfirmed, false)

// ════════════════════════════════════════════════════════
// 2. Injection resistance
// ════════════════════════════════════════════════════════
console.log('\n── 2. VISIT_CONFIRMED injection resistance ──')

// Inline (not on its own line)
const r4 = flow.parseAIResponse('The parent said "VISIT_CONFIRMED: YES" in their message', { ...baseFlow })
test('Inline in quotes — no trigger', r4.visitConfirmed, false)

// ════════════════════════════════════════════════════════
// 3. VISIT_CONFIRMED + HANDOFF coexistence
// ════════════════════════════════════════════════════════
console.log('\n── 3. VISIT_CONFIRMED + HANDOFF coexistence ──')

const r5 = flow.parseAIResponse('Visit confirmed!\nVISIT_CONFIRMED: YES\nHANDOFF: YES', { ...baseFlow })
test('Both signals: visitConfirmed', r5.visitConfirmed, true)
test('Both signals: shouldHandoff', r5.shouldHandoff, true)
test('Both cleaned from response', r5.cleanResponse, 'Visit confirmed!')

// ════════════════════════════════════════════════════════
// 4. Scoring — visitConfirmed → hot
// ════════════════════════════════════════════════════════
console.log('\n── 4. Scoring — visitConfirmed → hot ──')

const hotFlow1 = {
  collectedData: { parentName: 'Rajesh', preferredVisitTime: 'Tuesday' },
  goals: {},
  visitConfirmed: true,
}
const score1 = computeLeadScore(hotFlow1, 'school')
test('visitConfirmed → hot', score1.score, 'hot')
test('Reason includes "Visit confirmed"', score1.reason.includes('Visit confirmed'), true)

// preferredVisitTime alone still hot (backward compat)
const hotFlow2 = {
  collectedData: { preferredVisitTime: 'tomorrow' },
  goals: {},
}
const score2 = computeLeadScore(hotFlow2, 'school')
test('preferredVisitTime alone → still hot', score2.score, 'hot')

// Cold with no data
const score3 = computeLeadScore({ collectedData: {}, goals: {} }, 'school')
test('No data → cold', score3.score, 'cold')

// ════════════════════════════════════════════════════════
// 5. Scheduling config — vertical toggle
// ════════════════════════════════════════════════════════
console.log('\n── 5. Scheduling config — vertical toggle ──')

test('school: scheduling enabled', isSchedulingEnabled('school'), true)
test('realestate: scheduling disabled', isSchedulingEnabled('realestate'), false)
test('unknown vertical: scheduling disabled', isSchedulingEnabled('healthcare'), false)

// ════════════════════════════════════════════════════════
// 6. Prompt builder — RULE 6B content
// ════════════════════════════════════════════════════════
console.log('\n── 6. Prompt builder — RULE 6B ──')

const mockKb = { content: { about: { name: 'Test School' }, handoff: { staffPhone: '9876543210' } } }
const mockSession = {
  vertical: 'school',
  recentMessages: [],
  flowState: {
    goals: {},
    collectedData: {},
    visitConfirmed: false,
  },
}
const mockSettings = { agentName: 'Priya', displayName: 'Test School' }

const prompt = buildSystemPrompt(mockKb, mockSession, mockSettings, 'hello')
test('Prompt has RULE 6B', prompt.includes('RULE 6B'), true)
test('Prompt has VISIT SCHEDULING', prompt.includes('VISIT SCHEDULING'), true)
test('Prompt has VISIT_CONFIRMED: YES instruction', prompt.includes('VISIT_CONFIRMED: YES'), true)
test('Prompt has documents instruction', prompt.includes('Birth certificate'), true)
test('Prompt has visit hours', prompt.includes('9 AM'), true)

// Realestate — scheduling disabled prompt
const mockSessionRE = { ...mockSession, vertical: 'realestate' }
const promptRE = buildSystemPrompt(mockKb, mockSessionRE, mockSettings, 'hello')
test('Realestate prompt: scheduling DISABLED', promptRE.includes('DISABLED'), true)

// ════════════════════════════════════════════════════════
// 7. Prompt builder — missingInfo includes visit confirmation step
// ════════════════════════════════════════════════════════
console.log('\n── 7. Prompt builder — missingInfo visit confirm ──')

const sessionWithVisitTime = {
  vertical: 'school',
  recentMessages: [{ role: 'user', content: { text: 'I want admission' } }],
  flowState: {
    goals: { visitSuggested: true },
    collectedData: { parentName: 'Rajesh', preferredVisitTime: 'Tuesday' },
    visitConfirmed: false,
  },
}
const promptWithTime = buildSystemPrompt(mockKb, sessionWithVisitTime, mockSettings, 'Can I come Tuesday?')
test('Missing info includes visit confirm step', promptWithTime.includes('Confirm their visit'), true)

// After visit is confirmed, that item disappears
const sessionConfirmed = {
  ...sessionWithVisitTime,
  flowState: { ...sessionWithVisitTime.flowState, visitConfirmed: true },
}
const promptConfirmed = buildSystemPrompt(mockKb, sessionConfirmed, mockSettings, 'okay')
test('After confirm: no visit confirm in missing', promptConfirmed.includes('Confirm their visit'), false)

// ════════════════════════════════════════════════════════
// 8. Prompt builder — RULE 6 no longer mentions visit as handoff trigger
// ════════════════════════════════════════════════════════
console.log('\n── 8. Prompt builder — RULE 6 handoff/visit separation ──')

test('RULE 6 does NOT say "parent wants to visit" as handoff trigger',
  prompt.includes('parent wants to visit, talk to someone'), false)
test('RULE 6 mentions visiting is NOT a handoff',
  prompt.includes('wanting to VISIT is NOT a handoff'), true)

// ════════════════════════════════════════════════════════
// SUMMARY
// ════════════════════════════════════════════════════════
console.log(`\n═══════════════════════════════════════════════════════`)
console.log(`  TOTAL: ${total}  |  ✅ PASS: ${pass}  |  ❌ FAIL: ${fail}`)
console.log(`═══════════════════════════════════════════════════════\n`)

if (fail > 0) process.exit(1)
