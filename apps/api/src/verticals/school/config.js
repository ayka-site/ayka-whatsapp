// Export a JavaScript object called schoolConfig with these exact fields:
// vertical: 'school'
// persona: { name: 'Priya', role: 'Senior Admissions Counsellor' }
// goals: array of strings: ['inquiryUnderstood', 'parentNameCollected',
//   'studentInfoCollected', 'infoShared', 'visitSuggested', 'contactDetailsCollected']
// handoffTriggerPhrases: array of lowercase strings that mean a parent wants a human:
//   include variants of: speak to someone, talk to someone, real person, call me,
//   phone number, contact number, human, manager, not helpful, frustrated,
//   baat karni hai, number do, koi insaan
// quickReplies: {
//   greeting: ['Admission enquiry', 'Fee structure', 'Visit the school'],
//   afterFees: ['Schedule a visit', 'Talk to admissions team', 'More questions']
// }
// maxMessagesBeforeHandoffSuggestion: 10
// module.exports = schoolConfig
const schoolConfig = {
  vertical: 'school',
  persona: {
    name: 'Priya',
    role: 'Senior Admissions Counsellor'
  },
  goals: [
    'inquiryUnderstood',
    'parentNameCollected',
    'studentInfoCollected',
    'infoShared',
    'visitSuggested',
    'contactDetailsCollected'
  ],
  handoffTriggerPhrases: [
    'speak to someone', 'talk to someone', 'real person', 'call me', 'phone number', 'contact number',
    'human', 'manager', 'not helpful', 'frustrated', 'baat karni hai', 'number do', 'koi insaan',
    'kisi se baat', 'insaan chahiye', 'aadmi se baat', 'principal se milna'
  ],
  quickReplies: {
    greeting: ['Admission enquiry / दाखिला', 'Fee structure / फीस', 'Visit the school / स्कूल देखना'],
    afterFees: ['Schedule a visit / स्कूल आना', 'Talk to admissions team / बात करना', 'More questions / और जानकारी']
  },
  maxMessagesBeforeHandoffSuggestion: 10,

  // ── Visit Scheduling ──
  scheduling: {
    enabled: true,
    visitHours: '9 AM – 2 PM, Mon–Sat',
    documentsRequired: [
      'Birth certificate',
      'Previous year marksheet',
      'Transfer certificate (if applicable)',
    ],
  },

  // ── Lead Scoring Rules ──
  // Each rule receives flowState and returns a reason string (truthy = match) or null.
  // Evaluated in order: hot → warm → cold.
  scoringRules: {
    hot(flowState) {
      const cd = flowState.collectedData || {}
      const reasons = []
      if (flowState.visitConfirmed)       reasons.push('Visit confirmed')
      if (cd.preferredVisitTime)           reasons.push(`Visit time: ${cd.preferredVisitTime}`)
      if (flowState.handoffTriggered)      reasons.push('Handoff triggered')
      return reasons.length > 0 ? reasons.join(', ') : null
    },
    warm(flowState) {
      const cd = flowState.collectedData || {}
      if (cd.parentName && cd.studentName && cd.interestedClass) {
        return `Parent: ${cd.parentName}, Student: ${cd.studentName}, Class: ${cd.interestedClass}`
      }
      return null
    },
    cold(flowState) {
      const cd = flowState.collectedData || {}
      const known = [cd.parentName, cd.studentName, cd.interestedClass].filter(Boolean)
      if (known.length === 0) return 'No lead info collected yet'
      return `Partial info: ${known.join(', ')} — missing ${3 - known.length} key fields`
    },
  },
}

module.exports = schoolConfig