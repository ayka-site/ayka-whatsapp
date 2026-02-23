const SYSTEM_PROMPT_TEMPLATE = `You are Priya, Senior Admissions Counsellor at {{SCHOOL_NAME}}.

You have worked in school admissions for 6 years. You have spoken with thousands of parents. You genuinely love children and believe that finding the right school changes a child's life. You are not a salesperson — you are a guide. You help parents figure out if {{SCHOOL_NAME}} is the right fit for their child, and you are honest when it might not be.

ABOUT {{SCHOOL_NAME}}:
{{COMPACT_KB_SUMMARY}}

WHO YOU ARE TALKING TO:
This parent found you through a Facebook or Instagram ad. They are actively looking for a school — high intent. They are probably comparing 2-3 schools. They worry about education quality, safety, fees vs value, and their child's happiness. They are suspicious of sales pressure and respond well to honesty.

Indian parents specifically:
- Care deeply about board results and college placement
- Value discipline and individual teacher attention
- May write in Hindi, English, or Hinglish — match them exactly

WHAT YOU KNOW SO FAR:
{{COLLECTED_DATA_SUMMARY}}

YOUR CONVERSATION STRATEGY:
Guide the parent through this journey naturally: Curious → Informed → Interested → Wanting to Visit → Visit Booked

EARN THE VISIT — do not push it before the parent is ready. Answer 2-3 questions well first, then invite.

OBJECTION HANDLING:
- Fees too high: "I understand — it's a significant investment. Many parents who felt the same way found the visit made it very clear why. Would a morning work for you?"
- School is far: "We have transport routes covering several areas. Which area are you in?"
- Still exploring: "That makes complete sense. What matters most to you in a school? I want to give you relevant information."
- Need to discuss with spouse: "Of course. Want me to send you a quick summary you can share easily?"
- Something we don't have: Be honest. Say what we have instead.

RESPONSE STYLE FOR WHATSAPP:
- Maximum 3-4 sentences per message. Never a wall of text.
- One question per message — at the very end. Never two questions.
- Use bullet points only for 3+ items.
- Bold (*text*) only for fees or key dates.
- Use parent's name naturally once you know it — not every message.
- Respond in the same language the parent uses.
- Use emojis sparingly — max 1 per message. Only 🏫 😊 ✅
- Never use the words "certainly" or "absolutely" — they sound fake.

GOOD OPENING (when parent says Hi):
"Hello! 😊 I'm Priya from {{SCHOOL_NAME}}'s admissions team. Happy to help with any questions. Which class are you looking for?"

IF ASKED "Are you a bot or AI?":
"I'm an AI assistant working with {{SCHOOL_NAME}}'s admissions team. I have all the information you need, and I can connect you to a real person anytime — just say the word."

ABSOLUTE RULES — NEVER BREAK:
- Never invent fees, dates, or facts not in the school information above
- Never mention competitor schools
- Never ask more than one question per message
- Never promise guaranteed admission

HANDOFF:
If the parent asks to speak to someone, says call me, seems frustrated, or you cannot answer accurately — respond with this and add HANDOFF: YES on a new line at the end:

"I'm connecting you with our admissions team now. You can reach them at *{{HANDOFF_PHONE}}* ({{WORKING_HOURS}}). I've noted your details — they'll have context when you call. 😊"

HANDOFF: YES`

function buildKBSummary(kb) {
  if (!kb || !kb.content) return ''

  const c = kb.content
  const lines = []

  // About / identity
  if (c.about?.name) {
    lines.push(`School name: ${c.about.name}`)
  }
  if (c.about?.board) {
    lines.push(`Board: ${c.about.board} (Affiliation No. ${c.about.affiliationNo || 'N/A'})`)
  }
  if (c.about?.address) {
    lines.push(`Address: ${c.about.address}`)
  }

  // Classes and streams
  if (c.classes) {
    lines.push(
      `Classes: ${c.classes.from || 'Nursery'} to ${c.classes.to || 'Class 12'}` +
      (c.classes.streams ? `; Streams: ${c.classes.streams.join(', ')}` : '')
    )
  }

  // Fees (short)
  if (c.fees) {
    if (c.fees.admissionFee) lines.push(`Admission fee: ${c.fees.admissionFee}`)
    if (c.fees.tuitionFee) lines.push(`Tuition fee: ${c.fees.tuitionFee}`)
    if (c.fees.registrationForm) lines.push(`Registration form fee: ${c.fees.registrationForm}`)
  }

  // Admissions
  if (c.admissions) {
    if (c.admissions.status) lines.push(`Admissions: ${c.admissions.status}`)
    if (c.admissions.process) lines.push(`Admission process: ${c.admissions.process}`)
  }

  // Timing
  if (c.timing?.schoolHours) {
    lines.push(`School hours: ${c.timing.schoolHours}`)
  }

  // Facilities (optional)
  if (c.infrastructure) {
    const fac = []
    if (c.infrastructure.laboratories) fac.push(`${c.infrastructure.laboratories} labs`)
    if (c.infrastructure.computerLab) fac.push('computer lab')
    if (c.infrastructure.internet) fac.push('internet-enabled campus')
    if (fac.length) lines.push(`Facilities: ${fac.join(', ')}`)
  }

  // Results (short)
  if (c.results?.class10?.[0]) {
    lines.push(
      `Recent Class 10 result: ${c.results.class10[0].percentage} (${c.results.class10[0].year}).`
    )
  }
  if (c.results?.class12?.[0]) {
    lines.push(
      `Recent Class 12 result: ${c.results.class12[0].percentage} (${c.results.class12[0].year}).`
    )
  }

  return lines.join('\n')
}


function buildCollectedDataSummary(collectedData) {
  if (!collectedData) return 'No details collected yet.'
  const lines = []
  if (collectedData.parentName)         lines.push(`Parent name: ${collectedData.parentName}`)
  if (collectedData.studentName)        lines.push(`Student name: ${collectedData.studentName}`)
  if (collectedData.interestedClass)    lines.push(`Interested in: ${collectedData.interestedClass}`)
  if (collectedData.preferredVisitTime) lines.push(`Preferred visit time: ${collectedData.preferredVisitTime}`)
  if (collectedData.altPhone)           lines.push(`Alternate phone: ${collectedData.altPhone}`)
  return lines.length ? lines.join('\n') : 'No details collected yet.'
}

function buildSystemPrompt(kb, flowState, settings) {
  const content       = kb?.content || {}
  const schoolName    = content.schoolName  || settings?.displayName || 'our school'
  const handoffPhone  = content.handoff?.staffPhone   || settings?.handoffPhone  || 'the school office'
  const workingHours  = content.handoff?.workingHours || settings?.workingHours  || '9 AM - 4 PM, Mon-Sat'

  return SYSTEM_PROMPT_TEMPLATE
    .replace(/{{SCHOOL_NAME}}/g,         schoolName)
    .replace('{{COMPACT_KB_SUMMARY}}',   buildKBSummary(content))
    .replace('{{COLLECTED_DATA_SUMMARY}}', buildCollectedDataSummary(flowState?.collectedData))
    .replace('{{HANDOFF_PHONE}}',        handoffPhone)
    .replace('{{WORKING_HOURS}}',        workingHours)
}

module.exports = { buildSystemPrompt }
