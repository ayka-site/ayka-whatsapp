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
const axios = require('axios')

async function sendTextMessage(to, text, phoneNumberId, accessToken) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'text',
        text: { body: text }
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )
    return response.data
  } catch (err) {
    console.error('Error sending text message:', err.response?.data)
    throw err
  }
}

async function sendInteractiveButtons(to, bodyText, buttons, phoneNumberId, accessToken) {
  try {
    const response = await axios.post(
      `https://graph.facebook.com/v21.0/${phoneNumberId}/messages`,
      {
        messaging_product: 'whatsapp',
        to,
        type: 'interactive',
        interactive: { type: 'button', body: { text: bodyText }, action: { buttons } }
      },
      {
        headers: { Authorization: `Bearer ${accessToken}` }
      }
    )
    return response.data
  } catch (err) {
    console.error('Error sending interactive buttons:', err.response?.data)
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
    console.error('Error marking message as read:', err.response?.data)
    throw err
  }
}

module.exports = { sendTextMessage, sendInteractiveButtons, markAsRead }