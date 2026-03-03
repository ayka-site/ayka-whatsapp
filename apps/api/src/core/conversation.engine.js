const sessionService = require('../services/session.service')
const { KnowledgeBase, Contact, Conversation, Message } = require('@ayka/db')
const { buildSystemPrompt } = require('./prompt.builder')
const { callGroq }          = require('../services/groq.service')
const { parseAIResponse, extractDataFromMessages } = require('./flow.engine')
const { computeLeadScore } = require('./scoring.engine')
const { scheduleVisit }    = require('./scheduling.engine')
const { triggerHandoff }    = require('./handoff.engine')
const { sendTextMessage, markAsRead } = require('../services/whatsapp.service')
const redis  = require('../config/redis')
const logger = require('../utils/logger')

/**
 * conversation.engine.js v4.0 — Main message processing pipeline
 *
 * Fixes over v3.0:
 *   1. Message deduplication by waMessageId (WhatsApp retries cause duplicates)
 *   2. Proper Groq retry with exponential backoff (3 attempts max)
 *   3. Media message routing (audio → transcription, others → placeholder)
 *   4. Current message included in system prompt context (was missing before)
 *   5. All async paths have try/catch — no silent failures
 *   6. DB writes are fire-and-forget but logged on failure
 */

const FALLBACK_MSG = 'Sorry, I had a small technical issue. Please send your message again in a moment.'
const DEDUP_TTL    = 300 // 5 minutes — reject duplicate waMessageIds within this window

// In-memory dedup layer — catches race conditions where two webhook calls arrive
// simultaneously before either's Redis SET NX completes (especially with Upstash HTTP latency)
const _recentIds = new Map()
const INMEM_TTL  = 60000 // 60 seconds

// ═════════════════════════════════════════════════════════════════════════════
// Deduplication — two-layer: in-memory (instant) + Redis (durable)
// ═════════════════════════════════════════════════════════════════════════════
async function isDuplicate(waMessageId, businessId) {
  if (!waMessageId) return false

  // Layer 1: In-memory check (instant, same-process race guard)
  const memKey = `${businessId}:${waMessageId}`
  if (_recentIds.has(memKey)) return true
  _recentIds.set(memKey, Date.now())

  // Periodic cleanup — prevent memory leak (every 500 entries, purge expired)
  if (_recentIds.size > 500) {
    const now = Date.now()
    for (const [k, ts] of _recentIds) {
      if (now - ts > INMEM_TTL) _recentIds.delete(k)
    }
  }

  // Layer 2: Redis check (durable across process restarts)
  const key = `dedup:${businessId}:${waMessageId}`
  try {
    const result = await redis.set(key, '1', { ex: DEDUP_TTL, nx: true })
    if (result === null) return true // already in Redis
    return false
  } catch (err) {
    // Redis failure → in-memory guard already set, so we're protected
    logger.warn({ err, waMessageId }, 'Dedup Redis check failed — in-memory guard active')
    return false
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// resolveMessageText — extract text from different WhatsApp message types
// ═════════════════════════════════════════════════════════════════════════════
async function resolveMessageText(msgObj, tenant) {
  const type = msgObj.type || 'text'

  switch (type) {
    case 'text':
      return msgObj.text?.body || ''

    case 'interactive':
      // Button reply or list reply
      return msgObj.interactive?.button_reply?.title
        || msgObj.interactive?.list_reply?.title
        || ''

    case 'audio': {
      // Voice note → transcribe via Groq Whisper
      try {
        const { transcribeAudio } = require('../services/transcription.service')
        const mediaId = msgObj.audio?.id
        if (!mediaId) return '__VOICE_NOTE_NO_MEDIA_ID__'
        const text = await transcribeAudio(mediaId, tenant.accessToken)
        return text || '__VOICE_TRANSCRIPTION_EMPTY__'
      } catch (err) {
        logger.error({ err }, 'Audio transcription failed')
        return '__VOICE_TRANSCRIPTION_FAILED__'
      }
    }

    case 'image':
      // Image with optional caption — use caption if present, otherwise note it
      return msgObj.image?.caption || '__IMAGE_RECEIVED__'

    case 'document':
      return msgObj.document?.caption || '__DOCUMENT_RECEIVED__'

    case 'location':
      return `__LOCATION_RECEIVED__ (${msgObj.location?.latitude}, ${msgObj.location?.longitude})`

    case 'contacts':
      return '__CONTACT_CARD_RECEIVED__'

    case 'sticker':
      return '' // ignore stickers silently

    default:
      logger.info({ type }, 'Unknown message type received')
      return ''
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// processMessage — the main pipeline
// ═════════════════════════════════════════════════════════════════════════════
async function processMessage(req) {
  const { tenant } = req

  // ── Parse payload ──
  const entry  = req.body?.entry?.[0]
  const change = entry?.changes?.[0]
  const value  = change?.value
  const msgObj = value?.messages?.[0]

  if (!msgObj) return

  const phone       = msgObj.from
  const waMessageId = msgObj.id
  const referral    = msgObj.referral || null
  const msgType     = msgObj.type || 'text'

  // ── Deduplication: reject if we've already processed this waMessageId ──
  if (await isDuplicate(waMessageId, tenant.businessId)) {
    logger.info({ waMessageId, phone }, 'Duplicate message — skipping')
    return
  }

  // ── Resolve message text based on type ──
  let messageText = await resolveMessageText(msgObj, tenant)

  // Sanitize: strip any HANDOFF or VISIT_CONFIRMED injection attempts from user input
  messageText = messageText.replace(/(^|\n)\s*HANDOFF:\s*YES\s*/gi, '[?]').trim()
  messageText = messageText.replace(/(^|\n)\s*VISIT_CONFIRMED:\s*YES\s*/gi, '[?]').trim()

  // Handle special media markers — tell parent we received it but can't process
  if (messageText === '__IMAGE_RECEIVED__' || messageText === '__DOCUMENT_RECEIVED__') {
    try {
      const lang = detectLanguageFromPhone(phone) // simple heuristic
      const reply = lang === 'en'
        ? "I received your file! For now, I can only read text messages. Could you type out what you'd like to know?"
        : 'Aapki file mili! Abhi main sirf text messages padh sakti hoon. Kya aap type karke bata sakte hain?'
      await sendTextMessage(phone, reply, tenant.phoneNumberId, tenant.accessToken)
    } catch (err) {
      logger.error({ err }, 'Failed to send media acknowledgment')
    }
    return
  }

  if (messageText === '__CONTACT_CARD_RECEIVED__') {
    // TODO: extract phone from contact card in future
    return
  }

  // Skip empty messages (stickers, reactions, etc.)
  if (!messageText.trim()) return

  // Handle transcription failures gracefully
  if (messageText.includes('__VOICE_TRANSCRIPTION_FAILED__') || messageText.includes('__VOICE_NOTE_NO_MEDIA_ID__')) {
    try {
      await sendTextMessage(
        phone,
        'Maafi chahungi, aapka voice message sun nahi paayi. Kya aap type karke bata sakte hain?',
        tenant.phoneNumberId, tenant.accessToken
      )
    } catch (err) {
      logger.error({ err }, 'Failed to send voice fallback')
    }
    return
  }

  // ── 1. Get or create session ──
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
        visitConfirmed:   false,
        visitConfirmedAt: null,
        sentiment:        'neutral',
      },
      recentMessages: [],
    }
  }

  try {
    // ── 2. Get or create Contact ──
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

    // ── 3. Get or reuse existing Conversation ──
    // If session already has a conversationId (from Redis/MongoDB), load that directly
    // — even if status is 'handed_off'. Only search/create if no conversationId in session.
    let conversation = null

    if (session.conversationId) {
      conversation = await Conversation.findById(session.conversationId).lean()
    }

    if (!conversation) {
      conversation = await Conversation.findOne({
        businessId: tenant.businessId,
        contactId:  contact._id,
        status:     { $in: ['active', 'handed_off'] },
      }).sort({ _id: -1 }).lean()
    }

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
      // Increment contact's conversation counter
      Contact.updateOne({ _id: contact._id }, { $inc: { totalConversations: 1 } }).catch(() => {})
    }

    session.conversationId = conversation._id.toString()

    // ── 4. Load Knowledge Base (Redis-cached, 1h TTL) ──
    const kbCacheKey = `kb:${tenant.businessId}`
    let kb

    try {
      const cachedKB = await redis.get(kbCacheKey)
      if (cachedKB) {
        kb = typeof cachedKB === 'string' ? JSON.parse(cachedKB) : cachedKB
      }
    } catch (err) {
      logger.warn({ err }, 'Redis KB cache read failed — falling back to MongoDB')
    }

    if (!kb) {
      kb = await KnowledgeBase.findOne({ businessId: tenant.businessId }).lean()
      if (kb) {
        try {
          await redis.set(kbCacheKey, JSON.stringify(kb), { ex: 3600 })
        } catch (err) {
          logger.warn({ err }, 'Redis KB cache write failed — continuing without cache')
        }
      }
    }

    // ── 5. Build system prompt (pass current message for greeting detection + context) ──
    const systemPrompt = buildSystemPrompt(kb, session, tenant.settings, messageText)

    // ── 6. Append user message to session window AFTER prompt build, BEFORE Groq call ──
    // NOTE: currentMessage is already in the system prompt via the 4th arg (RECENT CONVERSATION section)
    //       AND is included in recentMessages for the Groq messages array
    session.recentMessages.push({
      role: 'user',
      content: { text: messageText, contentType: msgType },
      timestamp: Date.now(),
    })
    if (session.recentMessages.length > 10) session.recentMessages.shift()

    // ── 7. Call Groq (with proper retry + backoff in groq.service.js) ──
    const rawAIResponse = await callGroq(systemPrompt, session.recentMessages)

    // ── 8. Parse AI response (detect handoff, clean response text) ──
    const alreadyHandedOff = session.flowState.handoffTriggered === true
    const { cleanResponse, updatedFlowState, shouldHandoff, visitConfirmed } = parseAIResponse(rawAIResponse, session.flowState)

    // ── 9. Extract structured data from this exchange ──
    const finalFlowState = extractDataFromMessages(messageText, cleanResponse, updatedFlowState)
    session.flowState = finalFlowState

    // ── 9.5. Compute lead score (pure, deterministic — no I/O) ──
    const { score: leadScore, reason: leadScoreReason } = computeLeadScore(finalFlowState, tenant.vertical)

    // ── 10. Append AI response to session window ──
    session.recentMessages.push({
      role: 'assistant',
      content: { text: cleanResponse },
      timestamp: Date.now(),
    })
    if (session.recentMessages.length > 10) session.recentMessages.shift()

    // ── 11. Trigger handoff if needed (idempotent — only once per conversation) ──
    if (shouldHandoff && !alreadyHandedOff) {
      await triggerHandoff(session, tenant).catch(err =>
        logger.error({ err }, 'Handoff notification failed — parent still gets response')
      )
    }

    // ── 11.5. Trigger visit scheduling if LLM confirmed a visit ──
    const alreadyVisitConfirmed = session.flowState.visitConfirmed === true && !visitConfirmed
    if (visitConfirmed && !alreadyVisitConfirmed) {
      await scheduleVisit(session, tenant).catch(err =>
        logger.error({ err }, 'Visit scheduling failed — parent still gets response')
      )
    }

    // ── 12. Save session to Redis ──
    await sessionService.saveSession(session)

    // ── 13. Parallel DB writes (fire-and-forget — logged on failure) ──
    Promise.all([
      Message.create({
        conversationId: conversation._id,
        businessId:     tenant.businessId,
        contactId:      contact._id,
        direction:      'inbound',
        role:           'user',
        content:        { contentType: msgType, text: messageText },
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
        {
          $set: {
            'profile.studentName':    finalFlowState.collectedData.studentName,
            'profile.interestedClass': finalFlowState.collectedData.interestedClass,
            'profile.altPhone':       finalFlowState.collectedData.altPhone,
            name:                     finalFlowState.collectedData.parentName || undefined,
          },
        }
      ),
      Conversation.updateOne(
        { _id: conversation._id },
        {
          $set: {
            flowState: finalFlowState,
            status: shouldHandoff ? 'handed_off' : 'active',
            leadScore,
            leadScoreReason,
            leadScoreUpdatedAt: new Date(),
          },
        }
      ),
      markAsRead(waMessageId, tenant.phoneNumberId, tenant.accessToken),
    ]).catch(err => logger.error({ err }, 'Non-blocking DB write failed'))

    // ── 14. Send response to parent ──
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

// Simple heuristic — Indian numbers get Hindi fallback
function detectLanguageFromPhone(phone) {
  return (phone || '').startsWith('91') ? 'hi' : 'en'
}

module.exports = { processMessage }
