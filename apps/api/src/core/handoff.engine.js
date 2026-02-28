const { sendTextMessage } = require('../services/whatsapp.service')
const { KnowledgeBase }   = require('@ayka/db')
const logger = require('../utils/logger')

async function triggerHandoff(session, tenant) {
  const { parentName, studentName, interestedClass, altPhone } = session.flowState.collectedData || {}
  const phone = session.phone

  // Resolve staff phone: KB is the source of truth, tenant.settings is the fallback.
  // tenant.settings.handoffPhone may be undefined if the KB has not been loaded into
  // settings (common for new tenants), so we re-query the KB here.
  let staffPhone = tenant.settings?.handoffPhone || null
  if (!staffPhone) {
    try {
      const kb = await KnowledgeBase.findOne({ businessId: tenant.businessId }, { 'content.handoff': 1 }).lean()
      staffPhone = kb?.content?.handoff?.staffPhone || null
    } catch (kbErr) {
      logger.warn({ kbErr }, 'Could not load KB for handoff phone — notification may be skipped')
    }
  }

  if (!staffPhone) {
    logger.warn({ businessId: tenant.businessId }, 'No staffPhone configured — skipping handoff notification')
    return true
  }

  // Detect if conversation was in Hindi/Hinglish (check last few user messages)
  const recentUserMsgs = (session.recentMessages || [])
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content?.text || '')
    .join(' ')
    .toLowerCase()

  const hindiWords = ['hai', 'hain', 'kya', 'mein', 'chahiye', 'batao', 'ke', 'ka', 'ki', 'se', 'ho']
  const hindiCount = hindiWords.filter(w => recentUserMsgs.includes(w)).length
  const isHindi = hindiCount >= 2

  // Include altPhone in notification so staff don't have to ask again
  const contactLine = altPhone
    ? `${phone} (alt: ${altPhone})`
    : phone || 'Same as WhatsApp'

  const message = isHindi
    ? `🔔 Naya Admission Lead\n\nParent: ${parentName || 'Unknown'}\nStudent: ${studentName || 'N/A'}\nClass: ${interestedClass || 'N/A'}\nContact: ${contactLine}\n\nWhatsApp chatbot se aaye hain.`
    : `🔔 New Admission Lead\n\nParent: ${parentName || 'Unknown'}\nStudent: ${studentName || 'Not provided'}\nClass: ${interestedClass || 'Not mentioned'}\nContact: ${contactLine}\n\nThey came from WhatsApp chatbot.`

  try {
    await sendTextMessage(staffPhone, message, tenant.phoneNumberId, tenant.accessToken)
  } catch (err) {
    logger.error({ err }, 'Failed to send handoff notification')
  }

  return true
}

module.exports = { triggerHandoff }