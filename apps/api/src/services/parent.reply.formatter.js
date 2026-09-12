const CONTROL_MARKER = /^(?:NAME_PARENT|NAME_STUDENT|HANDOFF|VISIT_CONFIRMED)\s*:/i

function stripEmoji(value) {
  return String(value || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uFE0E\uFE0F\u200D]/g, '')
}

function normalizeWhatsAppBold(value) {
  return String(value || '')
    .replace(/\*{3}([^*\n]+?)\*{3}/g, '*$1*')
    .replace(/\*{2}([^*\n]+?)\*{2}/g, '*$1*')
    .replace(/__([^_\n]+?)__/g, '*$1*')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\*{2,}/g, '*')
}

function formatParentReply(value) {
  let text = String(value || '').replace(/\r\n/g, '\n')
  text = normalizeWhatsAppBold(stripEmoji(text))

  text = text
    .split('\n')
    .filter(line => !CONTROL_MARKER.test(line.trim()))
    .map(line => line.trim())
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // Parent-facing AI messages should remain far below WhatsApp's transport
  // ceiling. This is only a last-resort transport guard.
  if (text.length > 3900) text = `${text.slice(0, 3897).trimEnd()}...`
  return text
}

module.exports = {
  formatParentReply,
  _private: {
    stripEmoji,
    normalizeWhatsAppBold,
  },
}
