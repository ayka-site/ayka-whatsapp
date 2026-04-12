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
      'Aadhaar card (parent + child)',
      'Birth certificate',
      'Previous year marksheet',
      'Transfer certificate (if applicable)',
      '2 passport photos',
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
      return `Partial info: ${known.join(', ')} - missing ${3 - known.length} key fields`
    },
  },

  // ── Special Knowledge Packs (fallback facts if present in KB or needed in prompt context) ──
  specialKnowledge: {
    talentHunt2026: {
      name: 'Sant Pathik Talent Hunt 2026',
      scope: 'City-level talent platform to encourage confidence, creativity, and self-expression',
      participation: {
        ageGroup: '3 to 12 years',
        openForAll: true,
        fee: 'Free (no registration fee)',
      },
      categories: [
        'Fancy Dress with Rhymes (Age 3-5): National Leaders / Save Earth',
        'Ad Mad (Age 6-7)',
        'Storytelling with Props (Age 8-9): Open',
        'Singing (Age 10-12): Open',
        'Dancing (Age 10-12): Open',
      ],
      process: [
        'Record a clear performance video',
        'Send the video to official school WhatsApp',
        'Upload the same video on Instagram',
        'Tag Sant Pathik Talent Hunt Instagram page',
        'School accepts as collaboration',
      ],
      judging: [
        'Final score = Judges evaluation + Instagram engagement points',
        'Every 100 likes = 10 points',
      ],
      awards: {
        cashPrizePool: '₹21,000',
        perCategory: '1st, 2nd, 3rd positions',
        allParticipants: 'Certificate of Participation & Appreciation',
        firstPlaceTitles: {
          adMad: 'Pathik Ad Star',
          fancyDress: 'Pathik Costume Icon',
          storytelling: 'Pathik Kahani Samrat',
          singing: 'Pathik Sursamrat',
          dancing: 'Pathik Nrityangna',
        },
      },
    },
  },
}

module.exports = schoolConfig
