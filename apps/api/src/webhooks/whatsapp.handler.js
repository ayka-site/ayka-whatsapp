const { processMessage } = require('../core/conversation.engine')
const logger = require('../utils/logger')

async function handleWhatsAppWebhook(req, res) {
  // Always respond 200 immediately — Meta will retry if we don't
  res.sendStatus(200)

  try {
    const entry  = req.body?.entry?.[0]
    const change = entry?.changes?.[0]
    const value  = change?.value

    if (!value) return

    // Handle message status updates (delivered, read, failed)
    if (value.statuses?.length) {
      const status  = value.statuses[0]
      const { Message } = require('@ayka/db')
      await Message.updateOne(
        { waMessageId: status.id },
        { $set: { status: status.status } }
      ).catch(() => {}) // silent fail — status updates are not critical
      return
    }

    // Handle incoming messages
    if (!value.messages?.length) return

    const msgObj = value.messages[0]

    // Only process text messages for now
    if (msgObj.type !== 'text') {
      logger.info({ type: msgObj.type, from: msgObj.from }, 'Non-text message received — skipping')
      return
    }

    // Check rate limit flag set by rateLimiter middleware
    if (req.isRateLimited) {
      const { sendTextMessage } = require('../services/whatsapp.service')
      const tenant = req.tenant
      await sendTextMessage(
        msgObj.from,
        'You are sending messages too quickly. Please wait a moment and try again.',
        tenant.phoneNumberId,
        tenant.accessToken
      ).catch(() => {})
      return
    }

    await processMessage(req)

  } catch (err) {
    logger.error({ err }, 'whatsapp.handler unhandled error')
  }
}

module.exports = { handleWhatsAppWebhook }
