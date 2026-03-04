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

// Hindi ordinal words → class number mapping
const HINDI_CLASS_MAP = {
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
}

function extractDataFromMessages(userMessage, aiResponse, flowState, recentMessages) {
  const updated = JSON.parse(JSON.stringify(flowState)) // deep clone
  updated.recentMessages = recentMessages || [] // attach for bare-name detection
  const userLc  = userMessage.toLowerCase().trim()

  // Ensure collectedData exists
  if (!updated.collectedData) updated.collectedData = {}
  if (!updated.goals)         updated.goals = {}

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

  // ── Mark info shared if AI response is substantive ──
  if (aiResponse.length > 80) {
    updated.goals.infoShared = true
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
  const hasExplicitNameStatement = /\b(mera\s+naam|mera\s+name|my\s+name\s+is|i\s+am|i'm|this\s+is|main\s+hoon)\b/i.test(userMessage)
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
      const aiAskedName = /(?:naam|name|aapka\s+shubh|your\s+(?:good\s+)?name|aapka\s+naam)/i.test(lastAIText)

      if (aiAskedName) {
        // Check if user message is a bare name (1-3 words, mostly alpha, title-cased first word)
        const trimmed = userMessage.trim()
        const words = trimmed.split(/\s+/)
        if (words.length >= 1 && words.length <= 3) {
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

    // Priority 0: Hindi ordinal class names (paanchvi, aathvi, barahvi, etc.)
    for (const [hindi, num] of Object.entries(HINDI_CLASS_MAP)) {
      if (new RegExp(`\\b${hindi}\\b`, 'i').test(userMessage)) {
        updated.collectedData.interestedClass = `Class ${num}`
        break
      }
    }

    if (!updated.collectedData.interestedClass) {
      // Tier 1: Enrollment-specific context — most reliable
      const enrollmentPatterns = [
        /\b(?:admission|enrol(?:l(?:ment)?)?|join|seeking|want|need|looking)\s+(?:for|in|into)?\s*(?:class|grade|std|standard)?\s*([1-9]|1[0-2])\b/i,
        /\b(?:class|grade|std|standard|kaksha)\s*([1-9]|1[0-2])\s+(?:admission|enrol|join)/i,
        /\b([1-9]|1[0-2])(?:st|nd|rd|th)?\s+(?:admission|enrol|class\s+mein\s+daakhila)/i,
      ]

      // Tier 2 guard: skip if message context is possessive or "currently studying"
      // e.g. "class 5 ke teacher" | "mein padhta hai" | "currently in 8th grade"
      const isPossessiveOrCurrent =
        /mein\s+(?:padhta|padhti)\b|currently\s+in\b|\b(?:is|was|are|were)\s+in\s+(?:class|grade)?\s*\d|class\s*\d+\s*ke\b/i
        .test(userMessage)

      // Tier 2: Standard class mention (only if not possessive/current context)
      const classPatterns = [
        /\b(?:class|grade|std|standard|kaksha)\s*([1-9]|1[0-2])\b/i,
        /\b([1-9]|1[0-2])(?:st|nd|rd|th)?\s*(?:class|grade|standard|mein|me|mai)\b/i,
        /\b(nursery|lkg|ukg|kindergarten|prep|pre-?school|play\s*group)\b/i,
        /^\s*([1-9]|1[0-2])(?:st|nd|rd|th)?\s*$/i,   // bare standalone number
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
      const aiAskedStudent = /(?:bachch[ea]|bache|beta|beti|child|student|son|daughter).*(?:naam|name)/i.test(lastAIText)

      if (aiAskedStudent) {
        const trimmed = userMessage.trim()
        const words = trimmed.split(/\s+/)
        if (words.length >= 1 && words.length <= 3) {
          const allAlpha = words.every(w => /^[A-Za-z]+$/.test(w))
          if (allAlpha) {
            const candidate = words.map(w => w.charAt(0).toUpperCase() + w.slice(1).toLowerCase()).join(' ')
            if (candidate.length > 2 && !NOT_A_NAME.has(candidate.toLowerCase()) && !PROFANITY_BLOCKLIST.has(candidate.toLowerCase())) {
              updated.collectedData.studentName  = candidate
              updated.goals.studentInfoCollected = true
            }
          }
        }
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
      /\b(morning|afternoon|evening|subah|dopahar|shaam|10\s*(?:am|baje)|11\s*(?:am|baje)|12\s*(?:pm|baje))\b/i,
    ]
    // Only extract if the message clearly has visit intent
    // NOTE: bare 'aa' removed — it's too common in Hinglish ("aa raha tha", "aa gaya", etc.)
    if (/\b(visit|come|tour|dekh|milna|campus|schedule|set\s*up|plan|confirm|fix|arrange|book|appointment|aa\s+jaiye|aao|aa\s+sako|aa\s+sakte|dekhne\s+aa|milne\s+aa)\b/i.test(userLc)) {
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
  delete updated.recentMessages

  return updated
}

module.exports = { parseAIResponse, extractDataFromMessages }
