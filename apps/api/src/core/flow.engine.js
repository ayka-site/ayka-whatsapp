function parseAIResponse(rawResponse, flowState) {
  if (!rawResponse) {
    return { cleanResponse: '', updatedFlowState: flowState, shouldHandoff: false }
  }

  let cleanResponse    = rawResponse
  let updatedFlowState = JSON.parse(JSON.stringify(flowState)) // deep clone — never mutate original
  let shouldHandoff    = false

  if (/HANDOFF:\s*YES/i.test(cleanResponse)) {
    shouldHandoff = true
    updatedFlowState.handoffTriggered = true
    updatedFlowState.handoffAt        = new Date()
    cleanResponse = cleanResponse.replace(/\n?HANDOFF:\s*YES/gi, '').trim()
  }

  return { cleanResponse, updatedFlowState, shouldHandoff }
}

function extractDataFromMessages(userMessage, aiResponse, flowState) {
  const updated = JSON.parse(JSON.stringify(flowState)) // deep clone
  const text    = `${userMessage} ${aiResponse}`
  const userLc  = userMessage.toLowerCase().trim()

  // Ensure collectedData exists
  if (!updated.collectedData) updated.collectedData = {}
  if (!updated.goals)         updated.goals = {}

  // ── Mark inquiry understood after any real message ──
  if (userMessage.length > 1) {
    updated.goals.inquiryUnderstood = true
  }

  // ── Mark info shared if AI response is substantive ──
  if (aiResponse.length > 80) {
    updated.goals.infoShared = true
  }

  // ── Detect visit suggestion in AI response ──
  if (/\b(visit|come in|schedule|tour|aa jaiye|aa sakte|campus dekh|dekhne aaiye)\b/i.test(aiResponse)) {
    updated.goals.visitSuggested = true
  }

  // ── Extract parent name from user message ──
  if (!updated.collectedData.parentName) {
    const namePatterns = [
      /(?:i am|i'm|this is|my name is|mera naam|main)\s+([A-Z][a-z]{1,}(?:\s+[A-Z][a-z]{1,})?)/i,
      /^([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\s+(?:here|speaking|bol raha|bol rahi)/i,
    ]
    for (const pattern of namePatterns) {
      const match = userMessage.match(pattern)
      if (match?.[1] && match[1].length > 2) {
        updated.collectedData.parentName  = match[1].trim()
        updated.goals.parentNameCollected = true
        break
      }
    }
  }

  // ── Extract class/grade interest ──
  // Handles: "class 6", "6th", "6th class", "6", "nursery", "lkg", etc.
  if (!updated.collectedData.interestedClass) {
    const classPatterns = [
      /\b(?:class|grade|std|standard|kaksha)\s*([1-9]|1[0-2])\b/i,
      /\b([1-9]|1[0-2])(?:st|nd|rd|th)?\s*(?:class|grade|standard|mein|me|mai)\b/i,
      /\b(nursery|lkg|ukg|kindergarten|prep|pre-?school|play\s*group)\b/i,
      // Bare number: "6th" or "6" as standalone message or after whitespace
      /^\s*([1-9]|1[0-2])(?:st|nd|rd|th)?\s*$/i,
    ]
    for (const pattern of classPatterns) {
      const match = userMessage.match(pattern)
      if (match) {
        // Normalize: always store as "Class X" or the pre-primary name
        const raw = (match[1] || match[0]).trim()
        const num = parseInt(raw, 10)
        if (!isNaN(num) && num >= 1 && num <= 12) {
          updated.collectedData.interestedClass = `Class ${num}`
        } else {
          updated.collectedData.interestedClass = raw.charAt(0).toUpperCase() + raw.slice(1).toLowerCase()
        }
        updated.goals.studentInfoCollected = true
        break
      }
    }
  }

  // ── Extract budget ──
  // Handles: "50k", "50,000", "50000", "₹50k", "1.5 lakh", "1.5L", "50 thousand"
  if (!updated.collectedData.budget) {
    const budgetPatterns = [
      /(?:₹|rs\.?|inr)?\s*(\d+(?:\.\d+)?)\s*(?:k|K)\b/,                     // 50k, ₹50k
      /(?:₹|rs\.?|inr)?\s*(\d{1,2}(?:\.\d+)?)\s*(?:lakh|lac|L)\b/i,         // 1.5 lakh, 2L
      /(?:₹|rs\.?|inr)?\s*(\d{4,6})\b/,                                      // 50000, 15000
      /(?:₹|rs\.?|inr)?\s*(\d+(?:,\d{3})+)\b/,                               // 50,000
      /(?:₹|rs\.?|inr)?\s*(\d+)\s*(?:thousand|hazar|hazaar)\b/i,             // 50 thousand
    ]
    for (const pattern of budgetPatterns) {
      const match = userMessage.match(pattern)
      if (match) {
        updated.collectedData.budget = match[0].trim()
        break
      }
    }
  }

  // ── Extract priorities / preferences ──
  // Handles: "infra", "results", "discipline", "teacher attention", etc.
  if (!updated.collectedData.priorities) {
    const priorityMap = {
      'infra':          'Infrastructure & Facilities',
      'infrastructure': 'Infrastructure & Facilities',
      'facilities':     'Infrastructure & Facilities',
      'facility':       'Infrastructure & Facilities',
      'campus':         'Infrastructure & Facilities',
      'building':       'Infrastructure & Facilities',
      'lab':            'Infrastructure & Facilities',
      'result':         'Board Results & Academics',
      'results':        'Board Results & Academics',
      'academic':       'Board Results & Academics',
      'marks':          'Board Results & Academics',
      'topper':         'Board Results & Academics',
      'discipline':     'Discipline & Safety',
      'safety':         'Discipline & Safety',
      'strict':         'Discipline & Safety',
      'security':       'Discipline & Safety',
      'teacher':        'Teacher Attention & Quality',
      'attention':      'Teacher Attention & Quality',
      'faculty':        'Teacher Attention & Quality',
      'individual':     'Teacher Attention & Quality',
      'transport':      'Transport & Logistics',
      'bus':            'Transport & Logistics',
      'distance':       'Transport & Logistics',
    }
    for (const [keyword, label] of Object.entries(priorityMap)) {
      if (userLc.includes(keyword)) {
        updated.collectedData.priorities = label
        break
      }
    }
  }

  // ── Extract student name ──
  // Blacklist: words that look like names but are school/generic terms
  const NOT_A_NAME = new Set([
    'class', 'grade', 'standard', 'school', 'admission', 'enquiry',
    'your', 'their', 'child', 'student', 'enroll', 'wants', 'need',
    'help', 'info', 'detail', 'please', 'thanks', 'okay', 'yes', 'no',
  ])
  if (!updated.collectedData.studentName) {
    const studentPatterns = [
      /\bmy\s+(?:son|daughter|child|beta|beti|bachcha)(?:'s name)?\s+(?:is\s+)?([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/i,
      /\b(?:admission for|enquiry for)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/i,
    ]
    for (const pattern of studentPatterns) {
      const match = userMessage.match(pattern)
      if (match?.[1]) {
        const candidate = match[1].trim()
        // Reject if any word in the candidate is a blacklisted term
        const words = candidate.toLowerCase().split(/\s+/)
        if (!words.some(w => NOT_A_NAME.has(w))) {
          updated.collectedData.studentName  = candidate
          updated.goals.studentInfoCollected = true
        }
        break
      }
    }
  }

  // ── Extract alternate phone number ──
  if (!updated.collectedData.altPhone) {
    const phoneMatch = userMessage.match(/\b([6-9]\d{9})\b/)
    if (phoneMatch) {
      updated.collectedData.altPhone        = phoneMatch[1]
      updated.goals.contactDetailsCollected = true
    }
  }

  // ── Extract preferred visit time ──
  if (!updated.collectedData.preferredVisitTime) {
    const timePatterns = [
      /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|kal|aaj|parso)\b/i,
      /\b(morning|afternoon|evening|subah|dopahar|shaam|10\s*(?:am|baje)|11\s*(?:am|baje)|12\s*(?:pm|baje))\b/i,
    ]
    // Only extract if the message seems visit-related
    if (/\b(visit|come|tour|dekh|milna|aa|campus)\b/i.test(userLc)) {
      for (const pattern of timePatterns) {
        const match = userMessage.match(pattern)
        if (match) {
          updated.collectedData.preferredVisitTime = match[0].trim()
          break
        }
      }
    }
  }

  return updated
}

module.exports = { parseAIResponse, extractDataFromMessages }
