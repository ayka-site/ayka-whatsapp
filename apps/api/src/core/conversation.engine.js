const sessionService  = require('../services/session.service')
const { KnowledgeBase, Contact, Conversation, Message } = require('@ayka/db')
const { buildSystemPrompt }      = require('./prompt.builder')
const { callGroq }               = require('../services/groq.service')
const { parseAIResponse, extractDataFromMessages } = require('./flow.engine')
const { triggerHandoff }         = require('./handoff.engine')
const { sendTextMessage, markAsRead } = require('../services/whatsapp.service')
const redis  = require('../config/redis')
const logger = require('../utils/logger')

const FALLBACK_MSG = 'Sorry, I had a small technical issue. Please send your message again in a moment.'

async function processMessage(req) {
  const { tenant } = req

  // --- Parse payload ---
  const entry      = req.body?.entry?.[0]
  const change     = entry?.changes?.[0]
  const value      = change?.value
  const msgObj     = value?.messages?.[0]

  if (!msgObj) return

  const phone       = msgObj.from
  // Sanitize: strip any HANDOFF injection attempts from user input
  const messageText = (msgObj.text?.body || '').replace(/(^|\n)\s*HANDOFF:\s*YES\s*/gi, '[?]').trim()
  const waMessageId = msgObj.id
  const referral    = msgObj.referral || null

  if (!messageText.trim()) return // ignore non-text messages for now

  // --- 1. Get or create session ---
  let session = await sessionService.getSession(tenant.businessId, phone)

  if (!session) {
    session = {
      businessId:     tenant.businessId,
      resellerId:     tenant.resellerId,
      vertical:       tenant.vertical,
      phone,
      conversationId: null,
      contactId:      null,
      flowState: {
        goals: {
          inquiryUnderstood:       false,
          parentNameCollected:     false,
          studentInfoCollected:    false,
          infoShared:              false,
          visitSuggested:          false,
          contactDetailsCollected: false,
        },
        collectedData: {
          parentName:          null,
          studentName:         null,
          interestedClass:     null,
          preferredVisitTime:  null,
          altPhone:            null,
        },
        handoffTriggered: false,
        handoffAt:        null,
        sentiment:        'neutral',
      },
      recentMessages: [],
    }
  }

  try {
    // --- 2. Get or create Contact ---
    let contact = await Contact.findOne({ businessId: tenant.businessId, phone }).lean()

    if (!contact) {
      contact = await Contact.create({
        businessId:     tenant.businessId,
        resellerId:     tenant.resellerId,
        phone,
        firstContactAt: new Date(),
        lastMessageAt:  new Date(),
      })
    } else {
      await Contact.updateOne(
        { _id: contact._id },
        { $set: { lastMessageAt: new Date() } }
      )
    }

    session.contactId = contact._id.toString()

    // --- 3. Get or create active Conversation ---
    let conversation = await Conversation.findOne({
      businessId: tenant.businessId,
      contactId:  contact._id,
      status:     'active',
    }).lean()

    if (!conversation) {
      conversation = await Conversation.create({
        businessId: tenant.businessId,
        resellerId: tenant.resellerId,
        contactId:  contact._id,
        phone,
        vertical:   tenant.vertical,
        source: {
          sourceType: referral ? 'meta_ad' : 'direct',
          ctwaClid:   referral?.ctwa_clid   || null,
          adId:       referral?.source_id   || null,
          adHeadline: referral?.headline    || null,
        },
        flowState: session.flowState,
      })
    }

    session.conversationId = conversation._id.toString()

    // --- 4. Load Knowledge Base (Redis → MongoDB) ---
    const kbCacheKey = `kb:${tenant.businessId}`
let kb

const cachedKB = await redis.get(kbCacheKey)
if (cachedKB) {
  kb = typeof cachedKB === 'string' ? JSON.parse(cachedKB) : cachedKB
} else {
  kb = await KnowledgeBase.findOne({ businessId: tenant.businessId }).lean()
  if (kb) await redis.set(kbCacheKey, JSON.stringify(kb), { ex: 3600 })
}


    // --- 5. Build system prompt (pass full session + current message for accurate greeting detection) ---
    const systemPrompt = buildSystemPrompt(kb, session, tenant.settings, messageText)

    // --- 6. Append user message to session window (max 10) ---
    session.recentMessages.push({ role: 'user', content: { text: messageText }, timestamp: Date.now() })
    if (session.recentMessages.length > 10) session.recentMessages.shift()

    // --- 7. Call Groq ---
    const rawAIResponse = await callGroq(systemPrompt, session.recentMessages)

    // --- 8. Parse AI response ---
    const alreadyHandedOff = session.flowState.handoffTriggered === true // capture BEFORE parsing
    const { cleanResponse, updatedFlowState, shouldHandoff } = parseAIResponse(rawAIResponse, session.flowState)

    // --- 9. Extract data from this exchange ---
    const finalFlowState = extractDataFromMessages(messageText, cleanResponse, updatedFlowState)
    session.flowState = finalFlowState

    // --- 10. Append AI response to session window ---
    session.recentMessages.push({ role: 'assistant', content: { text: cleanResponse }, timestamp: Date.now() })
    if (session.recentMessages.length > 10) session.recentMessages.shift()

    // --- 11. Trigger handoff if needed (idempotent — only once per conversation) ---
    if (shouldHandoff && !alreadyHandedOff) {
      await triggerHandoff(session, tenant)
    }

    // --- 12. Save session ---
    await sessionService.saveSession(session)

    // --- 13. Parallel DB writes (non-blocking — do not await the whole block) ---
    Promise.all([
      Message.create({
        conversationId: conversation._id,
        businessId:     tenant.businessId,
        contactId:      contact._id,
        direction:      'inbound',
        role:           'user',
        content:        { contentType: 'text', text: messageText },
        waMessageId,
        status:         'delivered',
        timestamp:      new Date(),
      }),
      Message.create({
        conversationId: conversation._id,
        businessId:     tenant.businessId,
        contactId:      contact._id,
        direction:      'outbound',
        role:           'assistant',
        content:        { contentType: 'text', text: cleanResponse },
        status:         'sent',
        timestamp:      new Date(),
      }),
      Contact.updateOne(
        { _id: contact._id },
        { $set: { 'profile.studentName':      finalFlowState.collectedData.studentName,
                  'profile.interestedClass':   finalFlowState.collectedData.interestedClass,
                  'profile.altPhone':          finalFlowState.collectedData.altPhone,
                  name:                        finalFlowState.collectedData.parentName || undefined } }
      ),
      Conversation.updateOne(
        { _id: conversation._id },
        { $set: { flowState: finalFlowState,
                  status: shouldHandoff ? 'handed_off' : 'active' } }
      ),
      markAsRead(waMessageId, tenant.phoneNumberId, tenant.accessToken),
    ]).catch(err => logger.error({ err }, 'Non-blocking DB write failed'))

    // --- 14. Send response to parent ---
    await sendTextMessage(phone, cleanResponse, tenant.phoneNumberId, tenant.accessToken)

    return cleanResponse

  } catch (err) {
    logger.error({ err, phone, businessId: tenant.businessId }, 'processMessage failed')
    try {
      await sendTextMessage(phone, FALLBACK_MSG, tenant.phoneNumberId, tenant.accessToken)
    } catch (sendErr) {
      logger.error({ sendErr }, 'Failed to send fallback message')
    }
  }
}

module.exports = { processMessage }
