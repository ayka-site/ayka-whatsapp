const https = require('https')
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
const configuredGraphIpFamily = Number.parseInt(process.env.WHATSAPP_GRAPH_IP_FAMILY || '4', 10)
const GRAPH_IP_FAMILY = [4, 6].includes(configuredGraphIpFamily) ? configuredGraphIpFamily : 4

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

function parseResponseText(text) {
  if (!text) return null
  try {
    return JSON.parse(text)
  } catch (_) {
    return text
  }
}

function graphRequest(url, accessToken, body) {
  const token = String(accessToken || '').trim()
  if (!token) return Promise.reject(new Error('WhatsApp access token is missing'))

  const payload = JSON.stringify(body)
  const parsed = new URL(url)

  return new Promise((resolve, reject) => {
    const req = https.request({
      protocol: parsed.protocol,
      hostname: parsed.hostname,
      port: parsed.port || 443,
      path: `${parsed.pathname}${parsed.search}`,
      method: 'POST',
      family: GRAPH_IP_FAMILY,
      agent: false,
      headers: {
        Authorization: `Bearer ${token}`,
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(payload),
      },
    }, response => {
      let text = ''
      response.setEncoding('utf8')
      response.on('data', chunk => { text += chunk })
      response.on('end', () => {
        const data = parseResponseText(text)
        const status = Number(response.statusCode || 0)
        if (status < 200 || status >= 300) {
          const error = new Error(`WhatsApp Graph API request failed with HTTP ${status || 'UNKNOWN'}`)
          error.status = status || undefined
          error.data = data
          return reject(error)
        }
        resolve(data)
      })
    })

    req.setTimeout(REQUEST_TIMEOUT_MS, () => {
      const error = new Error(`WhatsApp Graph API request timed out after ${REQUEST_TIMEOUT_MS}ms`)
      error.code = 'ETIMEDOUT'
      req.destroy(error)
    })

    req.on('error', reject)
    req.write(payload)
    req.end()
  })
}

function summarizeRequestError(err) {
  return {
    message: err?.message,
    status: err?.status,
    data: err?.data,
    name: err?.name,
    code: err?.code,
    causeCode: err?.cause?.code,
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
    GRAPH_IP_FAMILY,
  },
}
