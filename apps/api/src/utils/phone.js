/**
 * normalizePhoneE164 - Normalize Indian/intl phone input to E.164 form.
 * @param {string} rawPhone - Raw phone string from webhook/user input.
 * @returns {string} Normalized E.164 phone (e.g. +919876543210) or best-effort cleaned value.
 */
function normalizePhoneE164(rawPhone) {
  const cleaned = String(rawPhone || '').replace(/[^\d+]/g, '').trim()
  if (!cleaned) return ''

  const digits = cleaned.replace(/\D/g, '')
  if (cleaned.startsWith('+')) return `+${digits}`

  // India local formats: 0XXXXXXXXXX or XXXXXXXXXX -> +91XXXXXXXXXX
  if (digits.length === 10) return `+91${digits}`
  if (digits.length === 11 && digits.startsWith('0')) return `+91${digits.slice(1)}`
  if (digits.length === 12 && digits.startsWith('91')) return `+${digits}`

  // Best effort for other country formats.
  return digits ? `+${digits}` : ''
}

/**
 * toWhatsAppRecipient - Convert E.164 phone to WhatsApp API recipient format.
 * @param {string} normalizedPhone - E.164 phone string.
 * @returns {string} Digits-only phone for WhatsApp Cloud API.
 */
function toWhatsAppRecipient(normalizedPhone) {
  return String(normalizedPhone || '').replace(/\D/g, '')
}

module.exports = { normalizePhoneE164, toWhatsAppRecipient }
