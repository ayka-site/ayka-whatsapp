// Write an async function triggerHandoff(session, tenant) 
// that does two things simultaneously using Promise.all:
//
// 1. Notify staff via WhatsApp:
//    Build a message string like:
//    "🔔 New Admission Lead\n\nParent: [parentName or 'Unknown']\nStudent: [studentName or 'Not provided']\nClass: [interestedClass or 'Not mentioned']\nContact: [session phone or 'Same as WhatsApp']\n\nThey came from WhatsApp chatbot."
//    Call sendTextMessage(tenant.settings.handoffPhone, message, tenant.phoneNumberId, tenant.accessToken)
//
// 2. (placeholder — already handled in conversation.engine by cleanResponse)
//    Just return true
//
// Get parentName, studentName, interestedClass from session.flowState.collectedData
// Get phone from session.phone
//
// Import { sendTextMessage } from '../services/whatsapp.service'
// Wrap in try/catch — if it fails, log the error but DO NOT throw.
//   Handoff notification failure must never crash the parent's conversation.
//
// module.exports = { triggerHandoff }
const { sendTextMessage } = require('../services/whatsapp.service')
const logger = require('../utils/logger')

async function triggerHandoff(session, tenant) {
  const { parentName, studentName, interestedClass } = session.flowState.collectedData || {}
  const phone = session.phone

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

  const message = isHindi
    ? `🔔 Naya Admission Lead\n\nParent: ${parentName || 'Unknown'}\nStudent: ${studentName || 'N/A'}\nClass: ${interestedClass || 'N/A'}\nContact: ${phone || 'Same as WhatsApp'}\n\nWhatsApp chatbot se aaye hain.`
    : `🔔 New Admission Lead\n\nParent: ${parentName || 'Unknown'}\nStudent: ${studentName || 'Not provided'}\nClass: ${interestedClass || 'Not mentioned'}\nContact: ${phone || 'Same as WhatsApp'}\n\nThey came from WhatsApp chatbot.`
  
  try { 
    await sendTextMessage(tenant.settings.handoffPhone, message, tenant.phoneNumberId, tenant.accessToken)
  } catch (error) {
    logger.error('Failed to send handoff notification:', error.message)
  }

  return true
}

module.exports = { triggerHandoff }