const logger = require('../utils/logger')
const { toWhatsAppRecipient } = require('../utils/phone')

const GRAPH_API_VERSION = String(process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0')
  .trim()
  .replace(/^\/+|\/+$/g, '')
const GRAPH_BASE_URL = `https://graph.facebook.com/${GRAPH_API_VERSION}`
const REQUEST_TIMEOUT_MS = Math.max(
  5000,
  Number.parseInt(process.env.WHATSAPP_REQUEST_TIMEOUT_MS || '15000', 10) || 15000,
)

function normalizeRecipient(to) {
  return toWhatsAppRecipient(to)
}

function resolvePublicMediaUrl(imageUrl) {
  const raw = String(imageUrl || '').trim()
  if (!raw) throw new Error('Image URL is empty')

  const parsed = new URL(raw)
  const isLocalhost = ['localhost', '127.0.0.1', '::1'].includes(parsed.hostname)
  if (!isLocalhost) return raw

  const publicBase = String(
    process.env.WHATSAPP_MEDIA_BASE_URL
    || process.env.API_PUBLIC_URL
    || process.env.PUBLIC_API_URL
    || ''
  ).replace(/\/+$/, '')

  if (!publicBase) {
    throw new Error('WhatsApp media URL points to localhost and no public media base URL is configured')
  }

  return `${publicBase}${parsed.pathname}${parsed.search}`
}

function messageUrl(phoneNumberId) {
  const id = String(phoneNumberId || '').trim()
  if (!id) throw new Error('WhatsApp phoneNumberId is missing')
  return `${GRAPH_BASE_URL}/${encodeURIComponent(id)}/messages`
}

async function parseResponseBody(response) {
  const text = await response.text()
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (_) {
    return text
  }
}

async function graphRequest(url, accessToken, body) {
  const token = String(accessToken || '').trim()
  if (!token) throw new Error('WhatsApp access token is missing')

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  })

  const data = await parseResponseBody(response)
  if (!response.ok) {
    const error = new Error(`WhatsApp Graph API request failed with HTTP ${response.status}`)
    error.status = response.status
    error.data = data
    throw error
  }
  return data
}

function summarizeRequestError(err) {
  return {
    message: err?.message,
    status: err?.status,
    data: err?.data,
    name: err?.name,
  }
}

async function sendTextMessage(to, text, phoneNumberId, accessToken) {
  try {
    const recipient = normalizeRecipient(to)
    const body = String(text || '').trim()
    if (!body) throw new Error('WhatsApp text body is empty')

    return await graphRequest(messageUrl(phoneNumberId), accessToken, {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'text',
      text: { body },
    })
  } catch (err) {
    logger.error({ err: summarizeRequestError(err), to }, 'Failed to send text message')
    throw err
  }
}

async function sendImageMessage(to, imageUrl, caption, phoneNumberId, accessToken) {
  try {
    const recipient = normalizeRecipient(to)
    const publicImageUrl = resolvePublicMediaUrl(imageUrl)
    const image = { link: publicImageUrl }
    if (caption && String(caption).trim()) image.caption = String(caption).trim()

    const data = await graphRequest(messageUrl(phoneNumberId), accessToken, {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'image',
      image,
    })
    return { ...data, resolvedMediaUrl: publicImageUrl }
  } catch (err) {
    logger.error({ err: summarizeRequestError(err), to, imageUrl }, 'Failed to send image message')
    throw err
  }
}

async function sendInteractiveButtons(to, bodyText, buttons, phoneNumberId, accessToken) {
  try {
    const recipient = normalizeRecipient(to)
    const normalizedButtons = (buttons || []).slice(0, 3).map(button => ({
      type: 'reply',
      reply: {
        id: String(button.id || '').slice(0, 256),
        title: String(button.title || '').slice(0, 20),
      },
    }))

    return await graphRequest(messageUrl(phoneNumberId), accessToken, {
      messaging_product: 'whatsapp',
      to: recipient,
      type: 'interactive',
      interactive: {
        type: 'button',
        body: { text: String(bodyText || '').slice(0, 1024) },
        action: { buttons: normalizedButtons },
      },
    })
  } catch (err) {
    logger.error({ err: summarizeRequestError(err), to }, 'Failed to send interactive buttons')
    throw err
  }
}

async function markAsRead(waMessageId, phoneNumberId, accessToken) {
  try {
    return await graphRequest(messageUrl(phoneNumberId), accessToken, {
      messaging_product: 'whatsapp',
      status: 'read',
      message_id: waMessageId,
    })
  } catch (err) {
    logger.error({ err: summarizeRequestError(err), waMessageId }, 'Failed to mark message as read')
    throw err
  }
}

module.exports = {
  sendTextMessage,
  sendImageMessage,
  sendInteractiveButtons,
  markAsRead,
  _private: {
    messageUrl,
    resolvePublicMediaUrl,
    graphRequest,
    GRAPH_API_VERSION,
  },
}
