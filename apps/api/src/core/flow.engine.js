function parseAIResponse(rawResponse, flowState) {
  if (!rawResponse) {
    return { cleanResponse: '', updatedFlowState: flowState, shouldHandoff: false }
  }

  let cleanResponse   = rawResponse
  let updatedFlowState = JSON.parse(JSON.stringify(flowState)) // deep clone — never mutate original
  let shouldHandoff   = false

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
  const text     = `${userMessage} ${aiResponse}`

  // Mark inquiry understood after any real message
  if (userMessage.length > 3) {
    updated.goals.inquiryUnderstood = true
  }

  // Mark info shared if AI response is substantive
  if (aiResponse.length > 80) {
    updated.goals.infoShared = true
  }

  // Detect visit suggestion in AI response
  if (/\b(visit|come in|schedule|tour|aa jaiye|aa sakte)\b/i.test(aiResponse)) {
    updated.goals.visitSuggested = true
  }

  // Extract parent name from user message
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

  // Extract class/grade interest from either message
  if (!updated.collectedData.interestedClass) {
    const classPatterns = [
      /\b(?:class|grade|std|standard|kaksha)\s*([1-9]|1[0-2])\b/i,
      /\b([1-9]|1[0-2])(?:st|nd|rd|th)?\s*(?:class|grade|standard)\b/i,
      /\b(nursery|lkg|ukg|kindergarten|prep)\b/i,
    ]
    for (const pattern of classPatterns) {
      const match = text.match(pattern)
      if (match) {
        updated.collectedData.interestedClass = match[0].trim()
        updated.goals.studentInfoCollected    = true
        break
      }
    }
  }

  // Extract student name
  if (!updated.collectedData.studentName) {
    const studentPatterns = [
      /\bmy\s+(?:son|daughter|child|beta|beti|bachcha)(?:'s name)?\s+(?:is\s+)?([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/i,
      /\b(?:admission for|enquiry for)\s+([A-Z][a-z]{2,}(?:\s+[A-Z][a-z]{2,})?)\b/i,
    ]
    for (const pattern of studentPatterns) {
      const match = userMessage.match(pattern)
      if (match?.[1]) {
        updated.collectedData.studentName = match[1].trim()
        updated.goals.studentInfoCollected = true
        break
      }
    }
  }

  // Extract alternate phone number
  if (!updated.collectedData.altPhone) {
    const phoneMatch = userMessage.match(/\b([6-9]\d{9})\b/)
    if (phoneMatch) {
      updated.collectedData.altPhone             = phoneMatch[1]
      updated.goals.contactDetailsCollected      = true
    }
  }

  return updated
}

module.exports = { parseAIResponse, extractDataFromMessages }
