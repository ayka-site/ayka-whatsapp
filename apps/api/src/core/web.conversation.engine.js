const sessionService = require('../services/session.service')
const { KnowledgeBase, Contact, Conversation, Message } = require('@ayka/db')
const { buildSystemPrompt, sanitizeUserMessageForPrompt } = require('./prompt.builder')
const { callLLM }           = require('../services/llm.service')
const { parseAIResponse, extractDataFromMessages } = require('./flow.engine')
const { computeLeadScore } = require('./scoring.engine')
const { triggerHandoff }   = require('./handoff.engine')
const redis  = require('../config/redis')
const logger = require('../utils/logger')

/**
 * web.conversation.engine.js — Message processing pipeline for Web Widget
 *
 * Mirrors conversation.engine.js but:
 *   - Sessions keyed by web:${visitorId} (not phone number)
 *   - No WhatsApp send — returns response directly
 *   - Creates contacts with source 'web_widget'
 *   - Supports visitorInfo (name, email, phone) from widget form
 */

const FALLBACK_MSG = 'Sorry, I had a small technical issue. Please try again in a moment.'

/**
 * escapeForRegex - Escape a dynamic string for safe regex usage.
 * @param {string} value - Raw string to escape.
 * @returns {string} Regex-safe escaped string.
 */
function escapeForRegex(value) {
  return String(value || '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

/**
 * normalizeStudentNameHonorific - Remove parent-style honorific from student name in output.
 * @param {string} text - Assistant response text.
 * @param {string|null|undefined} studentName - Collected child name.
 * @returns {string} Cleaned response text.
 */
function normalizeStudentNameHonorific(text, studentName) {
  const response = String(text || '')
  const name = String(studentName || '').trim()
  if (!name) return response

  const escaped = escapeForRegex(name)
  return response
    .replace(new RegExp(`(${escaped})\\s+ji\\b`, 'gi'), '$1')
    .replace(new RegExp(`(${escaped})\\s+जी`, 'g'), '$1')
}

async function processWebMessage(businessId, visitorId, messageText, visitorInfo = {}) {
  const sessionKey = `web:${visitorId}`

  const sanitizedMessage = sanitizeUserMessageForPrompt(messageText)

  // ── 1. Load business to get vertical + settings ──
  const { Business } = require('@ayka/db')
  const business = await Business.findById(businessId, {
    vertical: 1, resellerId: 1, settings: 1, 'whatsapp.accessToken': 1, 'whatsapp.phoneNumberId': 1,
  }).lean()

  if (!business) throw new Error('Business not found')

  const tenant = {
    businessId: business._id.toString(),
    resellerId: business.resellerId?.toString(),
    vertical:   business.vertical,
    settings:   business.settings,
  }

  // ── 2. Get or create session ──
  let session = await sessionService.getSession(businessId, sessionKey)

  if (!session) {
    session = {
      businessId,
      resellerId: tenant.resellerId,
      vertical:   tenant.vertical,
      phone: sessionKey,
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
          parentName:         visitorInfo.name || null,
          studentName:        null,
          interestedClass:    null,
          preferredVisitTime: null,
          altPhone:           visitorInfo.phone || null,
        },
        handoffTriggered: false,
        handoffAt:        null,
        visitConfirmed:   false,
        visitConfirmedAt: null,
        sentiment:        'neutral',
      },
      recentMessages: [],
    }

    // Pre-populate goals if we already have visitor info
    if (visitorInfo.name) session.flowState.goals.parentNameCollected = true
  }

  try {
    // ── 3. Get or create Contact ──
    const contactQuery = visitorInfo.email
      ? { businessId, $or: [{ email: visitorInfo.email }, { webVisitorId: visitorId }] }
      : { businessId, webVisitorId: visitorId }

    let contact = await Contact.findOne(contactQuery).lean()

    if (!contact) {
      contact = await Contact.create({
        businessId,
        resellerId:     tenant.resellerId,
        webVisitorId:   visitorId,
        name:           visitorInfo.name || null,
        email:          visitorInfo.email || null,
        phone:          visitorInfo.phone || null,
        source:         'web_widget',
        firstContactAt: new Date(),
        lastMessageAt:  new Date(),
      })
    } else {
      const updates = { lastMessageAt: new Date() }
      if (visitorInfo.name && !contact.name) updates.name = visitorInfo.name
      if (visitorInfo.email && !contact.email) updates.email = visitorInfo.email
      if (visitorInfo.phone && !contact.phone) updates.phone = visitorInfo.phone
      await Contact.updateOne({ _id: contact._id }, { $set: updates })
    }

    session.contactId = contact._id.toString()

    // ── 4. Get or create Conversation ──
    let conversation = null

    if (session.conversationId) {
      conversation = await Conversation.findById(session.conversationId).lean()
    }

    if (!conversation) {
      conversation = await Conversation.findOne({
        businessId,
        contactId: contact._id,
        status:    { $in: ['active', 'handed_off'] },
      }).sort({ _id: -1 }).lean()
    }

    if (!conversation) {
      conversation = await Conversation.create({
        businessId,
        resellerId: tenant.resellerId,
        contactId:  contact._id,
        phone:      sessionKey,
        vertical:   tenant.vertical,
        source:     { sourceType: 'web_widget' },
        flowState:  session.flowState,
      })
      // Increment contact's conversation counter
      Contact.updateOne({ _id: contact._id }, { $inc: { totalConversations: 1 } })
        .catch(err => logger.warn({ err, contactId: contact._id }, 'Failed to increment contact conversation counter (web widget)'))
    }

    session.conversationId = conversation._id.toString()

    // ── 5. Load Knowledge Base ──
    const kbCacheKey = `kb:${businessId}`
    let kb

    try {
      const cachedKB = await redis.get(kbCacheKey)
      if (cachedKB) {
        kb = typeof cachedKB === 'string' ? JSON.parse(cachedKB) : cachedKB
      }
    } catch (err) {
      logger.warn({ err }, 'Redis KB cache read failed')
    }

    if (!kb) {
      kb = await KnowledgeBase.findOne({ businessId }).lean()
      if (kb) {
        try {
          await redis.set(kbCacheKey, JSON.stringify(kb), { ex: 3600 })
        } catch (cacheErr) {
          logger.warn({ cacheErr, businessId }, 'Redis KB cache write failed (web widget)')
        }
      }
    }

    // ── 6. Build system prompt ──
    const systemPrompt = buildSystemPrompt(kb, session, tenant.settings, sanitizedMessage)

    // ── 7. Append user message ──
    session.recentMessages.push({
        role: 'user',
        content: { text: sanitizedMessage, contentType: 'text' },
      timestamp: Date.now(),
    })
    if (session.recentMessages.length > 10) session.recentMessages.shift()

    // ── 8. Call LLM ──
    const rawAIResponse = await callLLM(systemPrompt, session.recentMessages)

    // ── 9. Parse response ──
    const alreadyHandedOff = session.flowState.handoffTriggered === true
    const { cleanResponse, updatedFlowState, shouldHandoff, visitConfirmed } = parseAIResponse(rawAIResponse, session.flowState)

    // ── 10. Extract structured data ──
    const finalFlowState = extractDataFromMessages(sanitizedMessage, cleanResponse, updatedFlowState, session.recentMessages)
    session.flowState = finalFlowState
    const outboundResponse = normalizeStudentNameHonorific(cleanResponse, finalFlowState.collectedData?.studentName)

    // ── 11. Compute lead score ──
    const { score: leadScore, reason: leadScoreReason } = computeLeadScore(finalFlowState, tenant.vertical)

    // ── 12. Append AI response ──
    session.recentMessages.push({
      role: 'assistant',
      content: { text: outboundResponse },
      timestamp: Date.now(),
    })
    if (session.recentMessages.length > 10) session.recentMessages.shift()

    // ── 13. Trigger handoff if needed ──
    if (shouldHandoff && !alreadyHandedOff) {
      // Lazy-decrypt access token only if handoff notification needed
      try {
        const { decrypt } = require('../utils/encryption')
        const fullBusiness = await Business.findById(businessId, { 'whatsapp.accessToken': 1, 'whatsapp.phoneNumberId': 1 }).lean()
        const handoffTenant = {
          ...tenant,
          accessToken: decrypt(fullBusiness.whatsapp.accessToken),
          phoneNumberId: fullBusiness.whatsapp.phoneNumberId,
        }
        await triggerHandoff(session, handoffTenant)
      } catch (err) {
        logger.error({ err }, 'Handoff notification failed for web widget')
      }
    }

    // ── 14. Save session ──
    await sessionService.saveSession(session)

    // ── 15. Parallel DB writes ──
    Promise.all([
      Message.create({
        conversationId: conversation._id, businessId, contactId: contact._id,
        direction: 'inbound', role: 'user',
        content: { contentType: 'text', text: sanitizedMessage },
        status: 'delivered', timestamp: new Date(),
      }),
      Message.create({
        conversationId: conversation._id, businessId, contactId: contact._id,
        direction: 'outbound', role: 'assistant',
        content: { contentType: 'text', text: outboundResponse },
        status: 'sent', timestamp: new Date(),
      }),
      Contact.updateOne({ _id: contact._id }, {
        $set: {
          'profile.studentName':     finalFlowState.collectedData.studentName,
          'profile.interestedClass':  finalFlowState.collectedData.interestedClass,
          name:                       finalFlowState.collectedData.parentName || undefined,
        },
      }),
      Conversation.updateOne({ _id: conversation._id }, {
        $set: {
          flowState: finalFlowState,
          status: finalFlowState.handoffTriggered ? 'handed_off' : 'active',
          leadScore, leadScoreReason, leadScoreUpdatedAt: new Date(),
        },
      }),
    ]).catch(err => logger.error({ err }, 'Non-blocking DB write failed (web widget)'))

    // ── 16. Return response directly (no WhatsApp send) ──
    return {
      response:       outboundResponse,
      conversationId: conversation._id.toString(),
      flowState:      finalFlowState,
    }

  } catch (err) {
    logger.error({ err, visitorId, businessId }, 'processWebMessage failed')
    return { response: FALLBACK_MSG, error: true }
  }
}

module.exports = { processWebMessage }
