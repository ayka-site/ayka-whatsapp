const { processMessage } = require('../core/conversation.engine')
const { sendTextMessage } = require('../services/whatsapp.service')
const { Message }         = require('@ayka/db')
const logger              = require('../utils/logger')

// Message types that conversation.engine.js knows how to handle
const SUPPORTED_TYPES = new Set([
  'text', 'audio', 'image', 'document', 'location', 'contacts',
  'interactive', 'sticker',
])

function parseAllowlist(value) {
  return new Set(
    String(value || '')
      .split(',')
      .map((v) => v.trim())
      .filter(Boolean),
  )
}

const BOS_BRIDGE_PHONE_IDS = parseAllowlist(process.env.BOS_BRIDGE_PHONE_NUMBER_IDS)
const BOS_BRIDGE_BUSINESS_IDS = parseAllowlist(process.env.BOS_BRIDGE_BUSINESS_IDS)

async function isBosBridgeEnabledForTenant(tenant) {
  if (!tenant) return false

  const redis = require('../config/redis')

  try {
    const [phoneMatch, businessMatch] = await Promise.all([
      tenant.phoneNumberId
        ? redis._client.sismember('ayka:whatsapp:bridge:phoneNumberIds', String(tenant.phoneNumberId))
        : Promise.resolve(0),
      tenant.businessId
        ? redis._client.sismember('ayka:whatsapp:bridge:businessIds', String(tenant.businessId))
        : Promise.resolve(0),
    ])

    if (phoneMatch === 1 || businessMatch === 1) return true
  } catch (err) {
    logger.warn({ err }, 'Redis bridge allowlist check failed; falling back to env allowlist')
  }

  if (BOS_BRIDGE_PHONE_IDS.size === 0 && BOS_BRIDGE_BUSINESS_IDS.size === 0) return false

  if (tenant.phoneNumberId && BOS_BRIDGE_PHONE_IDS.has(String(tenant.phoneNumberId))) {
    return true
  }

  if (tenant.businessId && BOS_BRIDGE_BUSINESS_IDS.has(String(tenant.businessId))) {
    return true
  }

  return false
}

async function publishInboundToBos(req, msgObj, value) {
  const redis = require('../config/redis')
  const tenant = req.tenant

  if (!tenant) return false
  if (tenant.vertical !== 'msme') return false
  if (msgObj.type !== 'text') return false
  if (!isBosBridgeEnabledForTenant(tenant)) return false

  const text = msgObj.text?.body?.trim()
  if (!text) return false

  try {
    await redis._client.publish(
      'ayka:whatsapp:inbound',
      JSON.stringify({
        businessId: tenant.businessId,
        phoneNumberId: tenant.phoneNumberId,
        waMessageId: msgObj.id,
        from: msgObj.from,
        text,
        profileName: value?.contacts?.[0]?.profile?.name,
        timestamp: msgObj.timestamp,
      }),
    )

    logger.info(
      { businessId: tenant.businessId, waMessageId: msgObj.id },
      'Published inbound WhatsApp message to BOS bridge',
    )

    return true
  } catch (err) {
    logger.error({ err: err.message }, 'Failed to publish inbound WhatsApp message to BOS')
    return false
  }
}

async function handleWhatsAppWebhook(req, res) {
  // Always respond 200 immediately - Meta retries on non-2xx
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
      ).catch(err => logger.warn({ err, waMessageId: status.id }, 'Failed to persist WhatsApp status update')) // fire-and-forget - status updates are not critical
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
      logger.info({ type: msgType }, 'Unsupported message type - skipping')
      return
    }

    // ── Rate limit check (set by rateLimiter middleware) ──
    if (req.isRateLimited) {
      // Only send waiting message ONCE - first time rate limit triggers (count === 21)
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

    // ── MSME inbound is handled by BOS connector over Redis bridge ──
    const publishedToBos = await publishInboundToBos(req, msgObj, value)
    if (publishedToBos) return

    // ── Default path for non-MSME tenants ──
    await processMessage(req)

  } catch (err) {
    logger.error({ err }, 'whatsapp.handler unhandled error')
  }
}

module.exports = { handleWhatsAppWebhook }
