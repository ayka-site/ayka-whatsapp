function parseAIResponse(rawResponse, flowState) {
  if (!rawResponse) {
    return { cleanResponse: '', updatedFlowState: flowState, shouldHandoff: false }
  }

  let cleanResponse    = rawResponse
  let updatedFlowState = JSON.parse(JSON.stringify(flowState)) // deep clone — never mutate original
  let shouldHandoff    = false

  // Require HANDOFF: YES to appear on its own line — prevents embedded/quoted triggers
  if (/(^|\n)\s*HANDOFF:\s*YES\s*($|\n)/i.test(cleanResponse)) {
    shouldHandoff = true
    updatedFlowState.handoffTriggered = true
    updatedFlowState.handoffAt        = new Date()
    cleanResponse = cleanResponse.replace(/(^|\n)\s*HANDOFF:\s*YES\s*/gi, '').trim()
  }

  // Detect VISIT_CONFIRMED: YES signal — bot confirmed a visit appointment
  let visitConfirmed = false
  if (/(^|\n)\s*VISIT_CONFIRMED:\s*YES\s*($|\n)/i.test(cleanResponse)) {
    visitConfirmed = true
    updatedFlowState.visitConfirmed   = true
    updatedFlowState.visitConfirmedAt = new Date()
    cleanResponse = cleanResponse.replace(/(^|\n)\s*VISIT_CONFIRMED:\s*YES\s*/gi, '').trim()
  }

  return { cleanResponse, updatedFlowState, shouldHandoff, visitConfirmed }
}

// Hindi ordinal words → class number mapping (Latin + Devanagari)
const HINDI_CLASS_MAP = {
  // Latin script Hinglish ordinals
  'pehli': 1,  'pehla': 1,  'pratham': 1,
  'doosri': 2, 'doosra': 2,
  'teesri': 3, 'teesra': 3,
  'chauthi': 4, 'chautha': 4,
  'paanchvi': 5, 'paanchwa': 5,
  'chathi': 6,  'chhathi': 6,  'chhathvi': 6,
  'saatvi': 7,  'saatwa': 7,
  'aathvi': 8,  'aathwa': 8,
  'nauvi': 9,   'nauwa': 9,
  'dasvi': 10,  'daswa': 10,
  'gyarhvi': 11, 'gyarhwa': 11,
  'barahvi': 12, 'barahwa': 12,
  // Devanagari script ordinals
  'पहली': 1,   'प्रथम': 1,
  'दूसरी': 2,
  'तीसरी': 3,
  'चौथी': 4,
  'पाँचवीं': 5,  'पांचवीं': 5,  'पाँचवी': 5,
  'छठी': 6,    'छठवीं': 6,
  'सातवीं': 7,  'सातवी': 7,
  'आठवीं': 8,  'आठवी': 8,
  'नौवीं': 9,   'नौवी': 9,
  'दसवीं': 10,  'दसवी': 10,
  'ग्यारहवीं': 11, 'ग्यारहवी': 11,
  'बारहवीं': 12, 'बारहवी': 12,
}

// Devanagari number words → digit mapping
const DEVANAGARI_NUMBER_MAP = {
  'एक': 1, 'दो': 2, 'तीन': 3, 'चार': 4, 'पाँच': 5, 'पांच': 5,
  'छह': 6, 'छः': 6, 'सात': 7, 'आठ': 8, 'नौ': 9, 'दस': 10,
  'ग्यारह': 11, 'बारह': 12,
}

function extractDataFromMessages(userMessage, aiResponse, flowState, recentMessages) {
  const updated = JSON.parse(JSON.stringify(flowState)) // deep clone
  updated.recentMessages = recentMessages || [] // attach for bare-name detection
  const userLc  = userMessage.toLowerCase().trim()

  // Ensure collectedData exists
  if (!updated.collectedData) updated.collectedData = {}
  if (!updated.goals)         updated.goals = {}

  // Wrap all extraction in try/finally to guarantee recentMessages cleanup (Problem 13)
  try {

  // ── Rescheduling: reset visit state when user explicitly wants a new time ──
  // This allows the bot to re-collect the time preference and emit VISIT_CONFIRMED: YES again,
  // triggering scheduleVisit which will cancel the old appointment and create a new one.
  if (updated.visitConfirmed) {
    const rescheduleKeywords = /\b(reschedule|change.*(?:appointment|visit|time|date)|different\s+(?:time|day|date)|new\s+(?:time|day|date)|dobara\s+schedule|time\s+badal|date\s+badal|appointment\s+badal|visit\s+badal|phir\s+se\s+schedule|koi\s+aur\s+(?:time|din)|alag\s+(?:time|din|date))\b/i
    if (rescheduleKeywords.test(userLc)) {
      updated.visitConfirmed = false
      updated.visitConfirmedAt = null
      updated.collectedData.preferredVisitTime = null
      updated.goals.visitSuggested = true // keep this true so bot asks for new time
      logger.info?.({ phone: updated.phone }, 'Rescheduling requested — visit state reset')
    }
  }

  // ── Mark inquiry understood after any real message ──
  if (userMessage.length > 1) {
    updated.goals.inquiryUnderstood = true
  }

  // ── Mark info shared if AI response contains actual school facts ──
  // Not just any long response — must contain real KB content indicators
  if (!updated.goals.infoShared && aiResponse.length > 30) {
    const FACT_INDICATORS = /\b(₹|rupee|fee|fees|फीस|class\s*\d|nursery|hostel|होस्टल|admission|दाखिला|dakhila|daakhila|timing|\d\s*(?:am|pm|baje)|result|\d+\.\d+%|campus|infrastructure|lab|library|transport|bus|cbse|board|\bscience\b|\bcommerce\b|\barts\b|sports|hostel|smart\s*board|stem|robotics|tinkering)\b/i
    if (FACT_INDICATORS.test(aiResponse)) {
      updated.goals.infoShared = true
    }
  }

  // ── Detect visit suggestion in AI response ──
  if (/\b(visit|come in|schedule|tour|aa jaiye|aa sakte|campus dekh|dekhne aaiye)\b/i.test(aiResponse)) {
    updated.goals.visitSuggested = true
  }

  // Profanity/slur blocklist — reject these as names entirely
  const PROFANITY_BLOCKLIST = new Set([
    'nigga', 'nigger', 'fuck', 'shit', 'bitch', 'ass', 'dick', 'pussy',
    'bastard', 'whore', 'slut', 'cunt', 'faggot', 'retard', 'chutiya',
    'madarchod', 'behenchod', 'bhenchod', 'gaand', 'lund', 'randi',
    'harami', 'kutta', 'kutti', 'saala', 'saali', 'gadha', 'ullu',
    'bhosdike', 'bsdk', 'mc', 'bc', 'lodu', 'tatti',
  ])

  // Words that look like proper names but aren't parent names
  const NOT_A_PARENT_NAME = new Set([
    // English non-name verbs/participles
    'interested', 'calling', 'looking', 'enquiring', 'enquiry', 'checking',
    'wanting', 'planning', 'asking', 'writing', 'seeking', 'reaching',
    'contacting', 'texting', 'messaging', 'wondering', 'hoping',
    'speaking', 'coming', 'going', 'doing', 'having', 'getting',
    // Common English filler words
    'here', 'this', 'the', 'a', 'an', 'okay', 'ok', 'hi', 'hello',
    // Greetings in various languages (users often open with these, not their name)
    'namaste', 'namaskar', 'namashkra', 'namaskaar', 'namasthe', 'pranam',
    'salaam', 'adaab', 'assalam', 'vanakkam', 'hola', 'hey', 'heya', 'hye',
    'welcome', 'greetings', 'good', 'morning', 'evening', 'afternoon', 'night',
    // Honorific titles (must be in list so they get filtered from captures)
    'dr', 'mr', 'mrs', 'ms', 'miss', 'prof', 'er', 'eng', 'ca', 'cs',
    'adv', 'rev', 'capt', 'col', 'gen', 'lt', 'sgt', 'cdr', 'brig',
    // Roles and titles (not names)
    'parent', 'guardian', 'sir', 'madam', 'ma', 'ji', 'bhai',
    'system', 'administrator', 'admin', 'manager', 'director',
    'principal', 'teacher', 'professor', 'doctor',
    // School / admission terms
    'class', 'grade', 'school', 'admission', 'student', 'child',
    // Hindi pronouns and common words (Mein=I, Haan=yes, Nahi=no, etc.)
    'mein', 'main', 'haan', 'nahi', 'theek', 'acha', 'accha',
    'bas', 'woh', 'yeh', 'aap', 'tum', 'hum', 'kya', 'kab',
    'kahan', 'kaisa', 'kaun', 'yaar',
  ])

  // Normalize honorifics: "Dr." → "Dr " so regex can capture the surname after the period
  const cleanedForNames = userMessage.replace(
    /\b(Dr|Mr|Mrs|Ms|Miss|Prof|Er|Eng|CA|CS|Adv|Rev|Capt|Col|Gen)\./gi, '$1'
  )

  // ── Extract parent name from user message ──
  // Allow override if user EXPLICITLY states their name (covers name corrections too)
  const hasExplicitNameStatement = /\b(mera\s+naam|mera\s+name|my\s+name\s+is|i\s+am|i'm|this\s+is|main\s+hoon)\b/i.test(userMessage) || /मेरा\s+नाम/.test(userMessage)
  if (!updated.collectedData.parentName || hasExplicitNameStatement) {
    const namePatterns = [
      // Capture up to 3 words — run on cleanedForNames (periods stripped from honorifics)
      // Handles both "mera naam" (Hindi) and "mera name" (Hinglish English spelling)
      /(?:i am|i'm|this is|my name is|mera naam|mera name|main hoon)\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){0,2})/i,
      /^([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\s+(?:here|speaking|bol raha|bol rahi)/i,
    ]

    // Helper: validate a name candidate — not profanity, not too short
    const isValidName = (name) => {
      if (!name || name.length < 2) return false
      const words = name.toLowerCase().split(/\s+/)
      return !words.some(w => PROFANITY_BLOCKLIST.has(w))
    }

    for (const pattern of namePatterns) {
      const match = cleanedForNames.match(pattern)   // use cleaned version
      if (match?.[1] && match[1].length > 2) {
        // Keep only words that are title-cased (real names) AND not blacklisted
        const rawWords = match[1].trim().split(/\s+/)
        const cleanWords = rawWords.filter(w =>
          /^[A-Z]/.test(w) && !NOT_A_PARENT_NAME.has(w.toLowerCase())
        )
        const candidate = cleanWords.join(' ')
        if (isValidName(candidate)) {
          updated.collectedData.parentName  = candidate
          updated.goals.parentNameCollected = true
        }
        break
      }
    }

    // Bare name fallback: if the last AI message asked for their name,
    // and this message is 1-3 title-cased words (likely a name reply)
    if (!updated.collectedData.parentName) {
      const lastAI = (updated.recentMessages || flowState.recentMessages || []).filter(m => m.role === 'assistant').slice(-1)[0]
      const lastAIText = (lastAI?.content?.text || '').toLowerCase()
      const aiAskedName = /(?:नाम|शुभ|आपका|naam|name|aapka\s+shubh|your\s+(?:good\s+)?name|aapka\s+naam)/i.test(lastAIText)

      if (aiAskedName) {
        const trimmed = userMessage.trim()
        const words = trimmed.split(/\s+/)

        // Devanagari name: 1-3 Devanagari words
        const isDevanagari = words.every(w => /^[\u0900-\u097F]+$/.test(w))
        if (isDevanagari && words.length >= 1 && words.length <= 3) {
          const candidate = words.join(' ')
          if (candidate.length >= 2) {
            updated.collectedData.parentName  = candidate
            updated.goals.parentNameCollected = true
          }
        }

        // Latin name: existing logic
        if (!updated.collectedData.parentName && words.length >= 1 && words.length <= 3) {
          const allAlpha = words.every(w => /^[A-Za-z]+$/.test(w))
          const firstCapped = /^[A-Z]/.test(words[0])
          if (allAlpha && firstCapped) {
            const candidate = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
            if (isValidName(candidate) && !NOT_A_PARENT_NAME.has(candidate.toLowerCase())) {
              updated.collectedData.parentName  = candidate
              updated.goals.parentNameCollected = true
            }
          }
          // Also try if all lowercase (common on WhatsApp): "nandan" → "Nandan"
          if (!updated.collectedData.parentName && words.length <= 2) {
            const allLowerAlpha = words.every(w => /^[a-z]+$/.test(w) && w.length >= 2)
            if (allLowerAlpha) {
              const candidate = words.map(w => w.charAt(0).toUpperCase() + w.slice(1)).join(' ')
              if (isValidName(candidate) && !NOT_A_PARENT_NAME.has(candidate.toLowerCase())) {
                updated.collectedData.parentName  = candidate
                updated.goals.parentNameCollected = true
              }
            }
          }
        }
      }
    }

    // Devanagari explicit name patterns: "मेरा नाम रमेश है" / "मैं रमेश हूँ"
    // Allow override only for "मेरा नाम" (explicit correction), NOT "मैं X" alone
    if (!updated.collectedData.parentName || /मेरा\s+नाम/.test(userMessage)) {
      // Common Hindi stop words that appear after a name — must be excluded from capture
      const HINDI_STOP = new Set(['है', 'हैं', 'हूँ', 'हूं', 'हु', 'से', 'का', 'की', 'के', 'और', 'भी', 'तो', 'ने', 'पर', 'में', 'को'])
      const devNameMatch = userMessage.match(/(?:मेरा\s+नाम|मैं)\s+(?:है\s+)?([\u0900-\u097F]+(?:\s+[\u0900-\u097F]+){0,2})/)
      if (devNameMatch?.[1]) {
        // Filter out stop words from captured name
        const nameWords = devNameMatch[1].trim().split(/\s+/).filter(w => !HINDI_STOP.has(w))
        const candidate = nameWords.join(' ')
        if (candidate.length >= 2) {
          updated.collectedData.parentName  = candidate
          updated.goals.parentNameCollected = true
        }
      }
    }
  }

  // ── Class correction: user says "actually class 7" or "wrong class, it's class 9" ──
  // Requires BOTH a correction signal AND a new class number in the same message
  if (updated.collectedData.interestedClass) {
    const hasCorrectionSignal = /\b(actually|i meant|i mean|wrong class|not class|meant to say|galti|correction|actually class)\b/i.test(userLc)
    const hasNewClassMention  = /\b(?:class|grade|std|standard)?\s*([1-9]|1[0-2])\b/i.test(userMessage)
    if (hasCorrectionSignal && hasNewClassMention) {
      delete updated.collectedData.interestedClass
    }
  }

  // ── Extract class/grade interest ──
  // Priority 0: Hindi ordinals → Tier 1: enrollment context → Tier 2: bare mention (guarded)
  if (!updated.collectedData.interestedClass) {

    // Priority 0: Hindi ordinal class names (paanchvi, aathvi, barahvi, पाँचवीं, आठवीं, etc.)
    for (const [hindi, num] of Object.entries(HINDI_CLASS_MAP)) {
      if (new RegExp(`\\b${hindi}\\b`, 'i').test(userMessage) || userMessage.includes(hindi)) {
        updated.collectedData.interestedClass = `Class ${num}`
        break
      }
    }

    // Priority 0B: Devanagari digit patterns — "कक्षा 10", "क्लास 5", "कक्षा २०" (with Devanagari digits)
    if (!updated.collectedData.interestedClass) {
      const devClassMatch = userMessage.match(/(?:कक्षा|क्लास|श्रेणी)\s*([\u0966-\u096F0-9]{1,2})/)
      if (devClassMatch) {
        // Convert Devanagari digits to Arabic
        const numStr = devClassMatch[1].replace(/[\u0966-\u096F]/g, d => String(d.charCodeAt(0) - 0x0966))
        const num = parseInt(numStr, 10)
        if (num >= 1 && num <= 12) updated.collectedData.interestedClass = `Class ${num}`
      }
    }

    // Priority 0C: Devanagari number words — "दसवीं कक्षा", "पाँचवीं में"
    if (!updated.collectedData.interestedClass) {
      for (const [numWord, num] of Object.entries(DEVANAGARI_NUMBER_MAP)) {
        if (userMessage.includes(numWord)) {
          updated.collectedData.interestedClass = `Class ${num}`
          break
        }
      }
    }

    if (!updated.collectedData.interestedClass) {
      // Tier 1: Enrollment-specific context — most reliable
      const enrollmentPatterns = [
        /\b(?:admission|enrol(?:l(?:ment)?)?|join|seeking|want|need|looking)\s+(?:for|in|into)?\s*(?:class|grade|std|standard)?\s*([1-9]|1[0-2])\b/i,
        /\b(?:class|grade|std|standard|kaksha)\s*([1-9]|1[0-2])\s+(?:admission|enrol|join)/i,
        /\b([1-9]|1[0-2])(?:st|nd|rd|th|vi|vin|veen|va|wan|wi)?\s+(?:admission|enrol|class\s+mein\s+daakhila)/i,
        /\b(?:admission|daakhila|dakhila).*(?:class|grade|kaksha)?\s*([1-9]|1[0-2])(?:vi|vin|veen|va|wan|wi)?\b/i,
        /\b([1-9]|1[0-2])(?:vi|vin|veen|va|wan|wi)\s+(?:class|mein|me|mai|ke\s+liye)\b/i,
        // "Class X ke liye admission" / "10vi ke liye daakhila"
        /\b(?:class|grade|kaksha)?\s*([1-9]|1[0-2])(?:vi|vin|veen|va|wan|wi)?\s+ke\s+liye\s+(?:admission|daakhila|dakhila)/i,
      ]

      // Tier 2 guard: skip if message context is possessive or "currently studying"
      // e.g. "class 5 ke teacher" | "mein padhta hai" | "currently in 8th grade"
      // BUT NOT "class 10 ke liye admission" — "ke liye" means "for" (enrollment intent)
      const isPossessiveOrCurrent =
        /mein\s+(?:padhta|padhti)\b|currently\s+in\b|\b(?:is|was|are|were)\s+in\s+(?:class|grade)?\s*\d|class\s*\d+\s*ke\s+(?!liye\b)/i
        .test(userMessage)

      // Tier 2: Standard class mention (only if not possessive/current context)
      const classPatterns = [
        /\b(?:class|grade|std|standard|kaksha)\s*([1-9]|1[0-2])\b/i,
        /\b([1-9]|1[0-2])(?:st|nd|rd|th|vi|vin|veen|va|wan|wi)?\s*(?:class|grade|standard|mein|me|mai)\b/i,
        /\b(nursery|lkg|ukg|kindergarten|prep|pre-?school|play\s*group)\b/i,
        /^\s*([1-9]|1[0-2])(?:st|nd|rd|th|vi|vin|veen|va|wan|wi)?\s*$/i,   // bare standalone number with optional suffix
      ]

      let rawClass = null
      for (const pattern of enrollmentPatterns) {
        const match = userMessage.match(pattern)
        if (match) { rawClass = (match[1] || match[0]).trim(); break }
      }
      if (!rawClass && !isPossessiveOrCurrent) {
        // Use LAST match across all tier-2 patterns—last class mentioned tends to be the target
        // e.g. "currently in class 3, want class 7" → picks 7 (though 3 hits tier-2, 7 hits tier-1)
        // e.g. "class 3 aur class 7 mein daakhila" → picks 7 (last)
        let lastPos  = -1
        let lastRaw  = null
        for (const pattern of classPatterns) {
          const globalPat = new RegExp(pattern.source, (pattern.flags || '').replace('g', '') + 'g')
          let m
          while ((m = globalPat.exec(userMessage)) !== null) {
            if (m.index > lastPos) { lastPos = m.index; lastRaw = (m[1] || m[0]).trim() }
          }
        }
        rawClass = lastRaw
      }
      if (rawClass) {
        const num = parseInt(rawClass, 10)
        if (!isNaN(num) && num >= 1 && num <= 12) {
          updated.collectedData.interestedClass = `Class ${num}`
        } else {
          updated.collectedData.interestedClass = rawClass.charAt(0).toUpperCase() + rawClass.slice(1).toLowerCase()
        }
      }
    }
  }

  // Budget extraction REMOVED in v4.0 — fees are fixed per school, never ask budget.
  // The budget field was a false-positive magnet (school codes, years, PINs all matched).

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
    'your', 'their', 'child', 'student', 'enroll', 'wants', 'want',
    'need', 'needs', 'has', 'have', 'gets', 'says', 'told', 'goes',
    'also', 'only', 'just', 'even', 'very',
    'help', 'info', 'detail', 'please', 'thanks', 'okay', 'yes', 'no',
  ])
  if (!updated.collectedData.studentName) {
    const studentPatterns = [
      // English: "my son/daughter NAME" — up to 3 words captured
      /\bmy\s+(?:son|daughter|child|beta|beti|bachcha)(?:'s name)?\s+(?:is\s+)?([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\b/i,
      // Hindi possessive with mera/meri prefix: "meri beti Sneha"
      /\b(?:mera|meri|hamara|hamari|mere|hamare)\s+(?:beta|beti|bacha|bachcha|bachchi|bache|bacche)\s+(?:ka\s+naam\s+|ki\s+naam\s+)?(?:hai\s+)?(?:is\s+)?([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\b/i,
      // Hindi: "mere bache ka naam X hai" / "bache ka naam X"
      /\b(?:mera|meri|mere|hamare)\s+(?:bache|bacche|bachche|bachchon)\s+ka\s+naam\s+([A-Za-z]{2,}(?:\s+[A-Za-z]{2,}){0,2})/i,
      // Hindi: "naam X hai" when in student-name context (AI asked for child's name)
      /\b(?:bachche?|bache?|beta|beti)\s+ka\s+naam\s+([A-Za-z]{2,})\b/i,
      // Bare Hindi: "beti Sneha ke liye" (no mera/meri prefix needed)
      /\b(?:beta|beti|bacha|bachcha|bachchi)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\b/i,
      // "admission for NAME"
      /\b(?:admission for|enquiry for)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,}){0,2})\b/i,
    ]
    for (const pattern of studentPatterns) {
      const match = userMessage.match(pattern)
      if (match?.[1]) {
        // Apply title-case + blacklist filter (same approach as parentName)
        const rawWords = match[1].trim().split(/\s+/)
        const cleanWords = rawWords.filter(w => /^[A-Za-z]/.test(w) && !NOT_A_NAME.has(w.toLowerCase()) && !PROFANITY_BLOCKLIST.has(w.toLowerCase()))
        const candidate = cleanWords.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
        if (candidate.length > 2) {
          updated.collectedData.studentName  = candidate
          updated.goals.studentInfoCollected = true
        }
        break
      }
    }

    // Bare student name fallback: if AI asked for child's name and user replied with just a name
    if (!updated.collectedData.studentName) {
      const lastAI = (updated.recentMessages || []).filter(m => m.role === 'assistant').slice(-1)[0]
      const lastAIText = (lastAI?.content?.text || '').toLowerCase()
      const aiAskedStudent = /(?:बच्च[\u0947\u093e]|बचे|बेटा|बेटी|नाम|bachch[ea]|bache|beta|beti|child|student|son|daughter).*(?:नाम|naam|name)/i.test(lastAIText)

      if (aiAskedStudent) {
        const trimmed = userMessage.trim()
        const words = trimmed.split(/\s+/)

        // Devanagari student name
        if (words.length >= 1 && words.length <= 3) {
          const isDevanagari = words.every(w => /^[\u0900-\u097F]+$/.test(w))
          if (isDevanagari && trimmed.length >= 2) {
            updated.collectedData.studentName  = trimmed
            updated.goals.studentInfoCollected = true
          }
        }

        // Latin student name
        if (!updated.collectedData.studentName && words.length >= 1 && words.length <= 3) {
          const allAlpha = words.every(w => /^[A-Za-z]+$/.test(w))
          if (allAlpha) {
            const candidate = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
            if (candidate.length > 2 && !NOT_A_NAME.has(candidate.toLowerCase()) && !PROFANITY_BLOCKLIST.has(candidate.toLowerCase()) && !words.some(w => PROFANITY_BLOCKLIST.has(w.toLowerCase()))) {
              updated.collectedData.studentName  = candidate
              updated.goals.studentInfoCollected = true
            }
          }
        }
      }
    }

    // Devanagari explicit student name: "मेरे बेटे का नाम राहुल है" / "मेरी बेटी स्नेहा"
    if (!updated.collectedData.studentName) {
      const devStudentMatch = userMessage.match(/(?:मेर[\u0947\u0940\u093e]\s+(?:बेट[\u0947\u0940\u093e]|बच्च[\u0947\u093e]|बचे)(?:\s+का\s+नाम)?\s*(?:है\s+)?)\s*([\u0900-\u097F]+(?:\s+[\u0900-\u097F]+){0,2})/)
      if (devStudentMatch?.[1] && devStudentMatch[1].length >= 2) {
        updated.collectedData.studentName  = devStudentMatch[1].trim()
        updated.goals.studentInfoCollected = true
      }
    }
  }

  // ── Extract alternate phone number ──
  // Handles: plain 10-digit, +91 prefix, 91 prefix (Indian country code)
  if (!updated.collectedData.altPhone) {
    const phoneMatch = userMessage.match(/(?:(?:\+91|91)\s*)?([6-9]\d{9})\b/)
    if (phoneMatch) {
      updated.collectedData.altPhone        = phoneMatch[1]
      updated.goals.contactDetailsCollected = true
    }
  }

  // ── Extract preferred visit time ──
  if (!updated.collectedData.preferredVisitTime) {
    const timePatterns = [
      /\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|kal|aaj|parso)\b/i,
      /\b(morning|afternoon|subah|dopahar|10\s*(?:am|baje)|11\s*(?:am|baje)|12\s*(?:pm|baje)|1\s*(?:pm|baje)|2\s*(?:pm|baje))\b/i,
    ]

    // BLOCK invalid times — night, evening, Sunday are outside school hours (9AM–2PM Mon–Sat)
    const INVALID_TIME_MARKERS = /\b(raat|night|sunday|itwar|itwaar|evening|shaam|sham|rat\s*ke?|midnight|3\s*(?:am|pm|baje)|4\s*(?:pm|baje)|5\s*(?:pm|baje)|6\s*(?:pm|baje)|7\s*(?:pm|baje)|8\s*(?:pm|baje)|9\s*(?:pm|baje)|10\s*pm|11\s*pm|12\s*am)\b/i
    const hasInvalidTime = INVALID_TIME_MARKERS.test(userLc)

    // Only extract if the message clearly has visit intent AND is not at an invalid time
    if (!hasInvalidTime && /\b(visit|come|tour|dekh|milna|campus|schedule|set\s*up|plan|confirm|fix|arrange|book|appointment|aa\s+jaiye|aao|aa\s+sako|aa\s+sakte|dekhne\s+aa|milne\s+aa)\b/i.test(userLc)) {
      for (const pattern of timePatterns) {
        const match = userMessage.match(pattern)
        if (match) {
          updated.collectedData.preferredVisitTime = match[0].trim()
          break
        }
      }
    }
  }

  // Clean up: remove recentMessages from flowState before returning
  // (it was only attached temporarily for bare-name detection)
  } finally {
    delete updated.recentMessages
  }

  return updated
}

module.exports = { parseAIResponse, extractDataFromMessages }
