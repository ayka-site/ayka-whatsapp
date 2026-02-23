const redis = require('../config/redis')
const { Message, Conversation } = require('@ayka/db')

const SESSION_TTL = 86400 // 24 hours
const MAX_MESSAGES = 10

function sessionKey(businessId, phone) {
  return `session:${businessId}:${phone}`
}

async function getSession(businessId, phone) {
  const key = sessionKey(businessId, phone)

  const cached = await redis.get(key)
  if (cached) return typeof cached === 'string' ? JSON.parse(cached) : cached

  const convo = await Conversation.findOne({ businessId, phone, status: 'active' }).lean()
  if (!convo) return null

  const messages = await Message.find(
    { conversationId: convo._id, businessId },
    { role: 1, content: 1, timestamp: 1 }
  )
    .sort({ timestamp: -1 })
    .limit(MAX_MESSAGES)
    .lean()

  const session = {
    businessId,
    resellerId: convo.resellerId?.toString(),
    vertical: convo.vertical,
    phone, // IMPORTANT: needed by saveSession()
    conversationId: convo._id.toString(),
    contactId: convo.contactId?.toString(),
    flowState: convo.flowState,
    recentMessages: messages.reverse(),
  }

  await redis.set(key, JSON.stringify(session), { ex: SESSION_TTL })
  return session
}

async function saveSession(session) {
  const key = sessionKey(session.businessId, session.phone)
  await redis.set(key, JSON.stringify(session), { ex: SESSION_TTL })
}

async function clearSession(businessId, phone) {
  await redis.del(sessionKey(businessId, phone))
}

module.exports = { getSession, saveSession, clearSession }
