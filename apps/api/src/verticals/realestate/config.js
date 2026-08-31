/**
 * Real Estate vertical config
 *
 * NOTE: This vertical is not yet live. Config is a placeholder for scoring
 * rules and future persona/goal configuration. The scoring rules are defined
 * per the spec: budget + timeline based hot/warm/cold classification.
 */
const realestateConfig = {
  vertical: 'realestate',
  persona: {
    name: 'Ria',
    role: 'Property Consultant',
  },
  goals: [
    'inquiryUnderstood',
    'buyerNameCollected',
    'propertyTypeCollected',
    'budgetCollected',
    'timelineCollected',
    'locationPreferenceCollected',
    'siteVisitSuggested',
    'contactDetailsCollected',
  ],
  handoffTriggerPhrases: [
    'speak to someone', 'talk to someone', 'real person', 'call me',
    'phone number', 'contact number', 'human', 'agent', 'broker',
    'baat karni hai', 'number do', 'koi insaan',
  ],
  quickReplies: {
    greeting: ['Property enquiry', 'Budget range', 'Site visit'],
    afterInfo: ['Schedule a visit', 'Talk to consultant', 'More options'],
  },
  maxMessagesBeforeHandoffSuggestion: 12,

  // Site visits are qualified by the bot and handed off to the sales team.
  // The generic Appointment model is school-shaped, so keep hard scheduling off
  // until a real-estate visit model is introduced.
  scheduling: {
    enabled: false,
  },

  // ── Lead Scoring Rules ──
  // Budget thresholds in lakhs. Timeline in months.
  // Each rule receives flowState and returns a reason string or null.
  scoringRules: {
    hot(flowState) {
      const cd = flowState.collectedData || {}
      const budget   = _parseBudgetLakhs(cd.budget)
      const timeline = _parseTimelineMonths(cd.timeline)

      if (cd.preferredVisitTime || flowState.handoffTriggered) {
        const reasons = []
        if (cd.preferredVisitTime) reasons.push(`Site visit: ${cd.preferredVisitTime}`)
        if (flowState.handoffTriggered) reasons.push('Handoff triggered')
        if (cd.propertyId) reasons.push(`Property matched: ${cd.propertyId}`)
        return reasons.join(', ')
      }

      if (budget !== null && timeline !== null) {
        if (budget > 50 && timeline <= 3) {
          return `Budget ${budget}L, timeline ${timeline} months`
        }
      }

      return null
    },
    warm(flowState) {
      const cd = flowState.collectedData || {}
      const budget   = _parseBudgetLakhs(cd.budget)
      const timeline = _parseTimelineMonths(cd.timeline)

      // Budget > 50L but longer timeline
      if (budget !== null && budget > 50 && (timeline === null || timeline > 3)) {
        return `Budget ${budget}L, timeline ${timeline !== null ? timeline + ' months' : 'unknown'}`
      }

      // Budget <= 50L but short timeline
      if (timeline !== null && timeline <= 3 && (budget === null || budget <= 50)) {
        return `Timeline ${timeline} months, budget ${budget !== null ? budget + 'L' : 'unknown'}`
      }

      const filled = [
        cd.propertyType,
        cd.locationPreference,
        cd.bhk,
        cd.budget,
        cd.timeline,
        cd.purpose,
      ].filter(Boolean)
      if (filled.length >= 3) return `Qualified preference: ${filled.join(', ')}`

      return null
    },
    cold(flowState) {
      const cd = flowState.collectedData || {}
      const budget   = _parseBudgetLakhs(cd.budget)
      const timeline = _parseTimelineMonths(cd.timeline)
      const parts = []
      if (budget !== null)   parts.push(`Budget: ${budget}L`)
      if (timeline !== null) parts.push(`Timeline: ${timeline}mo`)
      if (cd.buyerName)      parts.push(`Name: ${cd.buyerName}`)
      if (parts.length === 0) return 'No lead info collected yet'
      return `Partial info: ${parts.join(', ')}`
    },
  },
}

// ── Helpers - budget/timeline parsing ──
// Budget: "65 lakhs", "65L", "1.2 crore", "1.2 Cr", "80,00,000", "6500000"
function _parseBudgetLakhs(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase().replace(/,/g, '').trim()

  // "X crore" / "X cr" → lakhs
  const crMatch = s.match(/([\d.]+)\s*(?:crore|cr)\b/)
  if (crMatch) return parseFloat(crMatch[1]) * 100

  // "X lakhs" / "X lakh" / "X lac" / "X L"
  const lMatch = s.match(/([\d.]+)\s*(?:lakhs?|lacs?|l)\b/)
  if (lMatch) return parseFloat(lMatch[1])

  // Raw number → convert to lakhs
  const num = parseFloat(s)
  if (!isNaN(num)) {
    if (num >= 100000) return num / 100000  // absolute → lakhs
    if (num > 0 && num <= 500) return num   // likely already in lakhs
  }

  return null
}

// Timeline: "3 months", "6mo", "1 year", "immediately", "next month"
function _parseTimelineMonths(raw) {
  if (!raw) return null
  const s = String(raw).toLowerCase().trim()

  if (/immediate|asap|jaldi|abhi|right\s*now/i.test(s)) return 1

  const moMatch = s.match(/([\d.]+)\s*(?:months?|mo)\b/)
  if (moMatch) return Math.round(parseFloat(moMatch[1]))

  const yrMatch = s.match(/([\d.]+)\s*(?:years?|yr)\b/)
  if (yrMatch) return Math.round(parseFloat(yrMatch[1]) * 12)

  if (/next\s*month/i.test(s)) return 1
  if (/next\s*year/i.test(s)) return 12

  return null
}

module.exports = realestateConfig
