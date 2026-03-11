// Write three async functions using axios for WhatsApp Cloud API v21.0:

// 1. sendTextMessage(to, text, phoneNumberId, accessToken)
//    POST https://graph.facebook.com/v21.0/{phoneNumberId}/messages
//    Bearer auth with accessToken
//    Body: { messaging_product: 'whatsapp', to, type: 'text', text: { body: text } }
//    Return response.data

// 2. sendInteractiveButtons(to, bodyText, buttons, phoneNumberId, accessToken)
//    buttons is array of { id, title } max 3 items
//    Build the interactive button message body per WhatsApp Cloud API spec
//    Return response.data

// 3. markAsRead(waMessageId, phoneNumberId, accessToken)
//    POST same URL, body: { messaging_product: 'whatsapp', status: 'read', message_id: waMessageId }
//    Return response.data

// Add try/catch on all three. On error log error.response?.data and throw.
// Export all three functions.
const axios  = require('axios')
const logger = require('../utils/logger')
const { toWhatsAppRecipient } = require('../utils/phone')

/**
 * normalizeRecipient - Ensure recipient value is valid for WhatsApp Cloud API.
 * @param {string} to - Raw recipient (E.164 or digits).
 * @returns {string} Digits-only WhatsApp recipient.
 */
function normalizeRecipient(to) {
  return toWhatsAppRecipient(to)
}

async function sendTextMessage(to, text, phoneNumberId, accessToken) {
  try {
    const recipient = normalizeRecipient(to)
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'text',
        text: { body: text }
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )
    return response.data
  } catch (err) {
    logger.error({ err: err.response?.data || err.message, to }, 'Failed to send text message')
    throw err
  }
}

async function sendImageMessage(to, imageUrl, caption, phoneNumberId, accessToken) {
  try {
    const recipient = normalizeRecipient(to)
    const image = { link: String(imageUrl || '').trim() }
    if (caption && String(caption).trim()) image.caption = String(caption).trim()

    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'image',
        image,
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )
    return response.data
  } catch (err) {
    logger.error({ err: err.response?.data || err.message, to, imageUrl }, 'Failed to send image message')
    throw err
  }
}

async function sendInteractiveButtons(to, bodyText, buttons, phoneNumberId, accessToken) {
  try {
    const recipient = normalizeRecipient(to)
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to: recipient,
        type: 'interactive',
        interactive: { type: 'button', body: { text: bodyText }, action: { buttons } }
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )
    return response.data
  } catch (err) {
    logger.error({ err: err.response?.data || err.message, to }, 'Failed to send interactive buttons')
    throw err
  }
}

async function markAsRead(waMessageId, phoneNumberId, accessToken) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        status: 'read',
        message_id: waMessageId
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )
    return response.data
  } catch (err) {
    logger.error({ err: err.response?.data || err.message, waMessageId }, 'Failed to mark message as read')
    throw err
  }
}

module.exports = { sendTextMessage, sendImageMessage, sendInteractiveButtons, markAsRead }
