const sessionService = require('../services/session.service')
const { KnowledgeBase, Contact, Conversation, Message, Appointment } = require('@ayka/db')
const { buildSystemPrompt, sanitizeUserMessageForPrompt } = require('./prompt.builder')
const { callLLM }           = require('../services/llm.service')
const { parseAIResponse, extractDataFromMessages } = require('./flow.engine')
const { computeLeadScore } = require('./scoring.engine')
const { scheduleVisit }    = require('./scheduling.engine')
const { triggerHandoff }    = require('./handoff.engine')
const { sendTextMessage, markAsRead } = require('../services/whatsapp.service')
const redis  = require('../config/redis')
const logger = require('../utils/logger')
const { normalizePhoneE164 } = require('../utils/phone')

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

const DEDUP_TTL    = 300 // 5 minutes — reject duplicate waMessageIds within this window
const PROCESS_LOCK_TTL = 30

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

/**
 * buildProcessLockKey - Build Redis lock key for one business+phone processing lane.
 * @param {string} businessId - Tenant business identifier.
 * @param {string} phone - Normalized E.164 phone.
 * @returns {string} Redis key used for mutex.
 */
function buildProcessLockKey(businessId, phone) {
  return `lock:process:${businessId}:${phone}`
}

/**
 * acquireProcessLock - Acquire a short-lived mutex for a phone conversation.
 * @param {string} key - Redis lock key.
 * @param {string} token - Random lock token.
 * @returns {Promise<boolean>} True if lock acquired, false otherwise.
 */
async function acquireProcessLock(key, token) {
  const result = await redis.set(key, token, { ex: PROCESS_LOCK_TTL, nx: true })
  return result !== null
}

/**
 * releaseProcessLock - Release lock only if caller still owns it.
 * @param {string} key - Redis lock key.
 * @param {string} token - Lock token originally used to acquire lock.
 * @returns {Promise<void>} Completes after best-effort unlock.
 */
async function releaseProcessLock(key, token) {
  try {
    await redis._client.eval(
      "if redis.call('get', KEYS[1]) == ARGV[1] then return redis.call('del', KEYS[1]) else return 0 end",
      1,
      key,
      token
    )
  } catch (err) {
    logger.warn({ err }, 'Failed to release conversation lock')
  }
}

/**
 * isContentFilterError - Detect Azure OpenAI content filter rejection.
 * @param {any} err - Error thrown by Azure SDK/http layer.
 * @returns {boolean} True when error matches content_filter rejection.
 */
function isContentFilterError(err) {
  const code = err?.code || err?.error?.code || err?.response?.data?.error?.code
  return err?.status === 400 && code === 'content_filter'
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

  const phone       = normalizePhoneE164(msgObj.from)
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
  messageText = sanitizeUserMessageForPrompt(messageText)

  // ── Load session early — needed for language-aware media fallback messages ──
  let session = await sessionService.getSession(tenant.businessId, phone)

  // Handle special media markers — tell parent we received it but can't process
  if (messageText === '__IMAGE_RECEIVED__' || messageText === '__DOCUMENT_RECEIVED__') {
    try {
      const lang = detectLanguageFromContext(session, phone)
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
    logger.info({ phone }, 'Contact card received; awaiting text follow-up')
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

  const lockKey = buildProcessLockKey(tenant.businessId, phone)
  const lockToken = `${Date.now()}:${Math.random().toString(36).slice(2, 10)}`
  const hasLock = await acquireProcessLock(lockKey, lockToken)
  if (!hasLock) {
    logger.info({ phone }, 'Concurrent message detected; skipping duplicate processing lane')
    return
  }

  // ── 1. Get or create session (loaded earlier for media fallback — reuse here) ──

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
      Contact.updateOne({ _id: contact._id }, { $inc: { totalConversations: 1 } })
        .catch(err => logger.warn({ err, contactId: contact._id }, 'Failed to increment contact conversation counter'))
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

    // ── 7. Call LLM (Azure OpenAI gpt-4o-mini) ──
    let rawAIResponse
    try {
      rawAIResponse = await callLLM(systemPrompt, session.recentMessages)
    } catch (llmErr) {
      if (isContentFilterError(llmErr)) {
        const digitsOnly = (phone || '').replace(/\D/g, '')
        const isIndian = digitsOnly.startsWith('91')
        const contentFilterReply = isIndian
          ? 'Main Priya hoon, aur main sirf school admissions mein help karti hoon. Aap admission, fees, ya school visit ke baare mein pooch sakte hain.'
          : 'I am Priya, and I can only help with school admissions. You can ask me about admissions, fees, or school visits.'
        await sendTextMessage(phone, contentFilterReply, tenant.phoneNumberId, tenant.accessToken)
        return contentFilterReply
      }
      throw llmErr
    }

    // ── 8. Parse AI response (detect handoff, clean response text) ──
    const alreadyHandedOff = session.flowState.handoffTriggered === true
    // Capture previous visit/data state BEFORE overwriting session.flowState
    const wasVisitPreviouslyConfirmed = session.flowState.visitConfirmed === true
    const prevCollectedData = { ...(session.flowState.collectedData || {}) }
    const { cleanResponse, updatedFlowState, shouldHandoff, visitConfirmed } = parseAIResponse(rawAIResponse, session.flowState)

    // ── 9. Extract structured data from this exchange ──
    const finalFlowState = extractDataFromMessages(messageText, cleanResponse, updatedFlowState, session.recentMessages)
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
    // Only schedule when VISIT_CONFIRMED: YES appears for the first time in this
    // conversation — OR after a reschedule reset (wasVisitPreviouslyConfirmed became
    // false via flow.engine reschedule detection). Prevents duplicate scheduling
    // if the bot re-emits the signal on subsequent messages.
    if (visitConfirmed && !wasVisitPreviouslyConfirmed) {
      await scheduleVisit(session, tenant).catch(err =>
        logger.error({ err }, 'Visit scheduling failed — parent still gets response')
      )
    }

    // ── 11.6. Update confirmed appointment with newly-collected profile data ──
    // Student name / parent name are often collected AFTER the appointment is first
    // created (bot asks "what's your child's name?" after confirming the visit time).
    if (finalFlowState.visitConfirmed) {
      const { studentName: newStudent, parentName: newParent } = finalFlowState.collectedData
      const { studentName: oldStudent, parentName: oldParent } = prevCollectedData
      if (newStudent !== oldStudent || newParent !== oldParent) {
        Appointment.updateOne(
          { conversationId: session.conversationId, status: 'confirmed' },
          { $set: { studentName: newStudent || undefined, parentName: newParent || undefined } }
        ).catch(err => logger.warn({ err }, 'Appointment profile update failed'))
      }
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
      // Language-aware natural error message — never sound robotic
      const hasDevanagari = /[\u0900-\u097F]/.test(messageText || '')
      const hasHindiWords = /\b(hai|kya|mein|batao|chahiye|kaise|nahi|hoon|aap)\b/i.test(messageText || '')
      const isIndian = (phone || '').replace(/\D/g, '').startsWith('91')

      let fallback
      if (hasDevanagari) {
        fallback = 'अभी थोड़ी तकनीकी दिक्कत आ रही है, क्या आप थोड़ी देर बाद मैसेज कर सकते हैं?'
      } else if (hasHindiWords || isIndian) {
        fallback = 'Abhi thodi technical dikkat aa rahi hai, kya aap thodi der baad message kar sakte hain?'
      } else {
        fallback = 'We are experiencing a brief technical issue. Could you please try again in a few minutes?'
      }

      await sendTextMessage(phone, fallback, tenant.phoneNumberId, tenant.accessToken)
    } catch (sendErr) {
      logger.error({ sendErr }, 'Failed to send fallback message')
    }
  }
  finally {
    await releaseProcessLock(lockKey, lockToken)
  }
}

// Session-aware language detection for media fallback messages
// Uses recent conversation messages instead of just phone prefix
function detectLanguageFromContext(session, phone) {
  const userMsgs = (session?.recentMessages || []).filter(m => m.role === 'user').slice(-3)
  for (const m of userMsgs) {
    const text = m.content?.text || ''
    if (/[\u0900-\u097F]/.test(text)) return 'hi' // Devanagari
    if (/\b(hai|kya|mein|batao|chahiye|kaise|nahi|hoon|aap|ji|haan|accha|theek|boliye|bataiye)\b/i.test(text)) return 'hi'
  }
  // Fallback: Indian phone number → Hindi, else English
  return (phone || '').replace(/\D/g, '').startsWith('91') ? 'hi' : 'en'
}

module.exports = { processMessage }
