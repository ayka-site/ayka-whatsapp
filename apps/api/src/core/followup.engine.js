const { Business, Conversation, Message } = require('@ayka/db')
const { decrypt } = require('../utils/encryption')
const { sendTextMessage } = require('../services/whatsapp.service')
const logger = require('../utils/logger')

const FOLLOWUP_INTERVAL_MS = Math.max(Number(process.env.RE_FOLLOWUP_INTERVAL_MS) || 15 * 60 * 1000, 60 * 1000)
const CUSTOMER_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_AGE_MS = 23 * 60 * 60 * 1000
const SCHEDULES = [
  { afterMs: 2 * 60 * 60 * 1000, label: '2h' },
  { afterMs: 20 * 60 * 60 * 1000, label: '20h' },
]

let timer = null
let running = false

function summarizeError(err) {
  return {
    message: err?.message,
    status: err?.response?.status || err?.status,
    data: err?.response?.data,
    code: err?.code,
  }
}

function buildFollowUpText(conversation, sentCount) {
  const data = conversation.flowState?.collectedData || {}
  const locality = data.location || data.preferredLocation || ''
  const budget = data.budget || ''
  const selected = data.propertyId || data.propertyTitle || ''

  if (sentCount === 0) {
    if (selected) {
      return `Hi, following up on the property we discussed. Would you like me to arrange a site visit or share more photos/details?`
    }
    if (locality || budget) {
      return `Hi, I found a few matching property options${locality ? ` around ${locality}` : ''}${budget ? ` within ${budget}` : ''}. Should I share the best 2 options here?`
    }
    return 'Hi, are you still looking for a property? Share your preferred location and budget and I will shortlist suitable options.'
  }

  return 'Last follow-up from my side. If you want, I can connect you with our property advisor for pricing, availability, or a site visit.'
}

async function getLastMessages(conversationId) {
  const [lastInbound, lastOutbound] = await Promise.all([
    Message.findOne({ conversationId, direction: 'inbound' }).sort({ timestamp: -1 }).lean(),
    Message.findOne({ conversationId, direction: 'outbound' }).sort({ timestamp: -1 }).lean(),
  ])
  return { lastInbound, lastOutbound }
}

async function runRealEstateFollowUps() {
  if (running) return
  running = true

  try {
    const now = Date.now()
    const candidates = await Conversation.find({
      vertical: 'realestate',
      status: 'active',
      leadScore: { $in: ['warm', 'hot'] },
      'flowState.visitConfirmed': { $ne: true },
      'flowState.handoffTriggered': { $ne: true },
      'flowState.followUps.disabled': { $ne: true },
      $or: [
        { 'flowState.followUps.sentCount': { $exists: false } },
        { 'flowState.followUps.sentCount': { $lt: SCHEDULES.length } },
      ],
      updatedAt: { $gte: new Date(now - CUSTOMER_WINDOW_MS) },
    }).limit(100).lean()

    for (const conversation of candidates) {
      const sentCount = Number(conversation.flowState?.followUps?.sentCount || 0)
      const schedule = SCHEDULES[sentCount]
      if (!schedule) continue

      const { lastInbound, lastOutbound } = await getLastMessages(conversation._id)
      if (!lastInbound?.timestamp) continue

      const inboundAt = new Date(lastInbound.timestamp).getTime()
      const ageMs = now - inboundAt
      if (ageMs < schedule.afterMs || ageMs > MAX_AGE_MS) continue

      const lastFollowUpAt = conversation.flowState?.followUps?.lastSentAt
        ? new Date(conversation.flowState.followUps.lastSentAt).getTime()
        : 0
      if (lastFollowUpAt >= inboundAt) continue

      const business = await Business.findOne(
        { _id: conversation.businessId, vertical: 'realestate', isActive: true },
        { 'whatsapp.phoneNumberId': 1, 'whatsapp.accessToken': 1 },
      ).lean()
      if (!business?.whatsapp?.phoneNumberId || !business?.whatsapp?.accessToken) continue

      let accessToken = business.whatsapp.accessToken
      if (String(accessToken).includes(':')) accessToken = decrypt(accessToken)

      const text = buildFollowUpText(conversation, sentCount)
      const waResult = await sendTextMessage(conversation.phone, text, business.whatsapp.phoneNumberId, accessToken)

      await Message.create({
        conversationId: conversation._id,
        businessId: conversation.businessId,
        contactId: conversation.contactId,
        direction: 'outbound',
        role: 'assistant',
        content: { contentType: 'text', text },
        waMessageId: waResult?.messages?.[0]?.id,
        status: 'sent',
        timestamp: new Date(),
      })

      await Conversation.updateOne(
        {
          _id: conversation._id,
          $or: [
            { 'flowState.followUps.sentCount': { $exists: false } },
            { 'flowState.followUps.sentCount': sentCount },
          ],
        },
        {
          $set: { 'flowState.followUps.lastSentAt': new Date() },
          $inc: { 'flowState.followUps.sentCount': 1 },
        },
      )
    }
  } catch (err) {
    logger.error({ err: summarizeError(err) }, 'Real-estate follow-up worker failed')
  } finally {
    running = false
  }
}

function startFollowUpWorker() {
  if (String(process.env.RE_FOLLOWUPS_ENABLED || 'true').toLowerCase() === 'false') return
  if (timer) return
  timer = setInterval(runRealEstateFollowUps, FOLLOWUP_INTERVAL_MS)
  timer.unref?.()
  setTimeout(runRealEstateFollowUps, 30 * 1000).unref?.()
  logger.info({ intervalMs: FOLLOWUP_INTERVAL_MS }, 'Real-estate follow-up worker started')
}

module.exports = { runRealEstateFollowUps, startFollowUpWorker }
