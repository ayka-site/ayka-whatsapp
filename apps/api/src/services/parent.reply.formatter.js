const CONTROL_MARKER = /^(?:NAME_PARENT|NAME_STUDENT|HANDOFF|VISIT_CONFIRMED)\s*:/i

function stripEmoji(value) {
  return String(value || '')
    .replace(/\p{Extended_Pictographic}/gu, '')
    .replace(/[\uFE0E\uFE0F\u200D]/g, '')
}

function normalizeWhatsAppBold(value) {
  let text = String(value || '')

  // WhatsApp uses one asterisk on each side for bold. Convert common Markdown
  // variants before collapsing any leftover repeated asterisks.
  text = text
    .replace(/\*{3}([^*\n]+?)\*{3}/g, '*$1*')
    .replace(/\*{2}([^*\n]+?)\*{2}/g, '*$1*')
    .replace(/__([^_\n]+?)__/g, '*$1*')
    .replace(/^\s*#{1,6}\s+/gm, '')
    .replace(/\*{2,}/g, '*')

  return text
}

function formatParentReply(value) {
  let text = String(value || '')
    .replace(/\r\n/g, '\n')

  text = stripEmoji(text)
  text = normalizeWhatsAppBold(text)

  text = text
    .split('\n')
    .filter(line => !CONTROL_MARKER.test(line.trim()))
    .map(line => line.replace(/[ \t]+$/g, ''))
    .join('\n')
    .replace(/[ \t]{2,}/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim()

  // WhatsApp Cloud API text messages have a finite body size. Parent-facing AI
  // replies should never approach this in normal operation; this is a final
  // transport guard, not a response-length strategy.
  if (text.length > 3900) {
    text = `${text.slice(0, 3897).trimEnd()}...`
  }

  return text
}

module.exports = {
  formatParentReply,
  _private: {
    stripEmoji,
    normalizeWhatsAppBold,
  },
}
