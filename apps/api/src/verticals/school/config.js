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
      const semantic = flowState.semanticContext?.conversationState || {}
      const reasons = []

      if (flowState.visitConfirmed) reasons.push('Visit confirmed')
      if (cd.preferredVisitTime) reasons.push(`Visit interest/time: ${cd.preferredVisitTime}`)
      if (flowState.handoffTriggered) reasons.push('Admissions handoff triggered')
      if (semantic.salesReadiness === 'high' && cd.interestedClass) reasons.push('High admission readiness with target class known')

      return reasons.length > 0 ? reasons.join(', ') : null
    },

    warm(flowState) {
      const cd = flowState.collectedData || {}
      const goals = flowState.goals || {}
      const semantic = flowState.semanticContext?.conversationState || {}
      const known = [cd.parentName, cd.studentName, cd.interestedClass].filter(Boolean)

      if (semantic.salesReadiness === 'medium') {
        return 'Parent is actively evaluating admission options'
      }
      if (cd.interestedClass && (cd.parentName || cd.studentName)) {
        return `Target class known with ${cd.studentName ? 'student' : 'parent'} identity collected`
      }
      if (cd.interestedClass && goals.infoShared) {
        return `Target class ${cd.interestedClass} known and school information shared`
      }
      if (known.length >= 2) {
        return `${known.length} key admission details collected`
      }

      return null
    },

    cold(flowState) {
      const cd = flowState.collectedData || {}
      const known = [cd.parentName, cd.studentName, cd.interestedClass].filter(Boolean)
      if (known.length === 0) return 'Initial enquiry - no lead profile collected yet'
      return `Early enquiry with ${known.length} key admission detail${known.length === 1 ? '' : 's'} collected`
    },
  },
}

module.exports = schoolConfig
