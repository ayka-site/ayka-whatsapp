const { processMessage } = require('../core/conversation.engine')
const { sendTextMessage } = require('../services/whatsapp.service')
const { Message }         = require('@ayka/db')
const logger              = require('../utils/logger')

/**
 * whatsapp.handler.js v4.0 — WhatsApp webhook entry point
 *
 * Fixes over v3.0:
 *   1. REMOVED the erroneous `module.exports = require(...)` line that clobbered exports
 *   2. Handles ALL message types (text, audio, image, document, location, contacts, interactive)
 *      — actual processing/transcription happens in conversation.engine.js
 *   3. Status updates handled gracefully (delivered, read, failed)
 *   4. Rate limit responses are language-aware
 */

// Message types that conversation.engine.js knows how to handle
const SUPPORTED_TYPES = new Set([
  'text', 'audio', 'image', 'document', 'location', 'contacts',
  'interactive', 'sticker',
])

async function handleWhatsAppWebhook(req, res) {
  // Always respond 200 immediately — Meta retries on non-2xx
  res.sendStatus(200)

  try {
    const entry  = req.body?.entry?.[0]
    const change = entry?.changes?.[0]
    const value  = change?.value

    if (!value) return

    // ── Handle message status updates (delivered, read, failed) ──
    if (value.statuses?.length) {
      const status = value.statuses[0]
      Message.updateOne(
        { waMessageId: status.id },
        { $set: { status: status.status } }
      ).catch(err => logger.warn({ err, waMessageId: status.id }, 'Failed to persist WhatsApp status update')) // fire-and-forget — status updates are not critical
      return
    }

    // ── Handle incoming messages ──
    if (!value.messages?.length) return

    const msgObj = value.messages[0]
    const msgType = msgObj.type || 'text'
    const { normalizePhoneE164 } = require('../utils/phone')
    const redis = require('../config/redis')

    // Normalize once so all downstream keys (rate limit/session/cache) stay consistent.
    msgObj.from = normalizePhoneE164(msgObj.from)

    // WhatsApp retries same webhook/event; skip duplicates for 5 minutes.
    if (msgObj.id) {
      const dedupKey = `processed:${msgObj.id}`
      const isNew = await redis.set(dedupKey, '1', { ex: 300, nx: true })
      if (isNew === null) {
        logger.info({ waMessageId: msgObj.id }, 'Duplicate webhook delivery skipped')
        return
      }
    }

    // Log non-text messages for visibility
    if (msgType !== 'text') {
      logger.info({ type: msgType, from: msgObj.from }, 'Non-text message received')
    }

    // Check if we support this message type
    if (!SUPPORTED_TYPES.has(msgType)) {
      logger.info({ type: msgType }, 'Unsupported message type — skipping')
      return
    }

    // ── Rate limit check (set by rateLimiter middleware) ──
    if (req.isRateLimited) {
      // Only send waiting message ONCE — first time rate limit triggers (count === 21)
      // Subsequent rate-limited messages are silently dropped to avoid spamming
      if (req.rateLimitCount === 21) {
        const tenant = req.tenant
        const phone = req.normalizedPhone || msgObj.from
        const digitsOnly = phone.replace(/\D/g, '')
        const isIndian = digitsOnly.startsWith('91')
        const reply = isIndian
          ? 'Ek minute rukiye, main aapka pichla message padh rahi hoon.'
          : 'Just a moment please, I\'m reading your previous message.'

        await sendTextMessage(
          phone, reply,
          tenant.phoneNumberId, tenant.accessToken
        ).catch(err => logger.warn({ err, phone }, 'Failed to send rate-limit wait message'))
      }
      return
    }

    // ── Process the message through conversation engine ──
    await processMessage(req)

  } catch (err) {
    logger.error({ err }, 'whatsapp.handler unhandled error')
  }
}

module.exports = { handleWhatsAppWebhook }
