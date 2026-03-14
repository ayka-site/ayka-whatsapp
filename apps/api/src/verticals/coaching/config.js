/**
 * Coaching Vertical Config — IAP Professional & similar coaching/training institutes.
 *
 * Persona: Riya — friendly inquiry counsellor
 * Goals: collect name → phone/contact → course interest → qualification → demo suggestion
 * Escalation: fee negotiation / complaints → director
 */

const coachingConfig = {
  vertical: 'coaching',

  persona: {
    name: 'Riya',
    role: 'Course Inquiry Counsellor',
  },

  // Lead-capture goal stages
  goals: [
    'inquiryUnderstood',
    'nameCollected',
    'courseInterestCollected',
    'qualificationCollected',
    'demoSuggested',
    'contactCollected',
  ],

  handoffTriggerPhrases: [
    'speak to someone', 'talk to someone', 'real person', 'call me', 'contact number',
    'human', 'manager', 'director', 'vinay', 'vinay sir', 'not helpful', 'frustrated',
    'baat karni hai', 'number do', 'koi insaan', 'kisi se baat', 'insaan chahiye',
    'aadmi se baat', 'fee kam karo', 'discount chahiye', 'negotiation', 'complaint',
    'problem hai', 'shikayat', 'issue hai',
  ],

  quickReplies: {
    greeting: ['Course enquiry', 'Fees & duration', 'Free demo class'],
    afterCourseInfo: ['Book a demo class', 'Talk to counsellor', 'More questions'],
  },

  maxMessagesBeforeHandoffSuggestion: 12,

  // No pre-booking needed; demo is walk-in any Monday
  scheduling: {
    enabled: false,
  },

  // Lead scoring
  scoringRules: {
    hot(flowState) {
      const cd = flowState.collectedData || {}
      const reasons = []
      if (flowState.demoConfirmed)    reasons.push('Demo class confirmed')
      if (flowState.handoffTriggered) reasons.push('Handoff triggered')
      if (cd.courseInterest)          reasons.push(`Course: ${cd.courseInterest}`)
      return reasons.length > 0 ? reasons.join(', ') : null
    },
    warm(flowState) {
      const cd = flowState.collectedData || {}
      if (cd.name && cd.courseInterest && cd.qualification) {
        return `Name: ${cd.name}, Course: ${cd.courseInterest}, Qualification: ${cd.qualification}`
      }
      return null
    },
    cold(flowState) {
      const cd = flowState.collectedData || {}
      const known = [cd.name, cd.courseInterest, cd.qualification].filter(Boolean)
      if (known.length === 0) return 'No lead info collected yet'
      return `Partial info: ${known.join(', ')}`
    },
  },
}

module.exports = coachingConfig
