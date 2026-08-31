const schoolConfig = {
  vertical: 'school',
  persona: {
    name: 'Priya',
    role: 'Admissions Counsellor',
  },
  goals: [
    'inquiryUnderstood',
    'parentNameCollected',
    'studentInfoCollected',
    'infoShared',
    'visitSuggested',
    'contactDetailsCollected',
  ],
  quickReplies: {
    greeting: ['Admission enquiry', 'Fee structure', 'Visit the school'],
    afterFees: ['Schedule a visit', 'Talk to admissions team', 'More questions'],
  },
  maxMessagesBeforeHandoffSuggestion: 10,

  // Operational scheduling constraints. School factual/marketing knowledge does
  // not belong here; it must come from the tenant KnowledgeBase document.
  scheduling: {
    enabled: true,
    visitHours: '9 AM – 2 PM, Mon–Sat',
    documentsRequired: [
      'Aadhaar card (parent + child)',
      'Birth certificate',
      'Previous year marksheet',
      'Transfer certificate (if applicable)',
      '2 passport photos',
    ],
  },

  scoringRules: {
    hot(flowState) {
      const cd = flowState.collectedData || {}
      const reasons = []
      if (flowState.visitConfirmed) reasons.push('Visit confirmed')
      if (cd.preferredVisitTime) reasons.push(`Visit time: ${cd.preferredVisitTime}`)
      if (flowState.handoffTriggered) reasons.push('Handoff triggered')
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
      return `Partial info: ${known.join(', ')} - missing ${3 - known.length} key fields`
    },
  },
}

module.exports = schoolConfig
