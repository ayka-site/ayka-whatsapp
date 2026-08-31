const axios = require('axios')
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

function summarizeAxiosError(err) {
  return {
    message: err?.message,
    status: err?.response?.status,
    data: err?.response?.data,
  }
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

function requestConfig(accessToken) {
  const token = String(accessToken || '').trim()
  if (!token) throw new Error('WhatsApp access token is missing')
  return {
    headers: { Authorization: `Bearer ${token}` },
    timeout: REQUEST_TIMEOUT_MS,
  }
}

async function sendTextMessage(to, text, phoneNumberId, accessToken) {
  try {
    const recipient = normalizeRecipient(to)
    const body = String(text || '').trim()
    if (!body) throw new Error('WhatsApp text body is empty')

    const response = await axios.post(
      messageUrl(phoneNumberId),
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body },
      },
      requestConfig(accessToken),
    )
    return response.data
  } catch (err) {
    logger.error({ err: summarizeAxiosError(err), to }, 'Failed to send text message')
    throw err
  }
}

async function sendImageMessage(to, imageUrl, caption, phoneNumberId, accessToken) {
  try {
    const recipient = normalizeRecipient(to)
    const publicImageUrl = resolvePublicMediaUrl(imageUrl)
    const image = { link: publicImageUrl }
    if (caption && String(caption).trim()) image.caption = String(caption).trim()

    const response = await axios.post(
      messageUrl(phoneNumberId),
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'image',
        image,
      },
      requestConfig(accessToken),
    )
    return { ...response.data, resolvedMediaUrl: publicImageUrl }
  } catch (err) {
    logger.error({ err: summarizeAxiosError(err), to, imageUrl }, 'Failed to send image message')
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

    const response = await axios.post(
      messageUrl(phoneNumberId),
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'interactive',
        interactive: {
          type: 'button',
          body: { text: String(bodyText || '').slice(0, 1024) },
          action: { buttons: normalizedButtons },
        },
      },
      requestConfig(accessToken),
    )
    return response.data
  } catch (err) {
    logger.error({ err: summarizeAxiosError(err), to }, 'Failed to send interactive buttons')
    throw err
  }
}

async function markAsRead(waMessageId, phoneNumberId, accessToken) {
  try {
    const response = await axios.post(
      messageUrl(phoneNumberId),
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId,
      },
      requestConfig(accessToken),
    )
    return response.data
  } catch (err) {
    logger.error({ err: summarizeAxiosError(err), waMessageId }, 'Failed to mark message as read')
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
    GRAPH_API_VERSION,
  },
}
