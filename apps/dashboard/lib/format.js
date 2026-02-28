/**
 * Format number with Indian locale (1,00,000)
 */
export function formatNumber(num) {
  if (num == null) return '0'
  return new Intl.NumberFormat('en-IN').format(num)
}

/**
 * Relative timestamp: "just now", "3 minutes ago", "Yesterday at 14:30", "24 Feb at 10:15"
 */
export function relativeTime(dateStr) {
  if (!dateStr) return ''
  const date = new Date(dateStr)
  const now = new Date()
  const diff = now.getTime() - date.getTime()
  const mins = Math.floor(diff / 60000)
  const hours = Math.floor(diff / 3600000)
  const days = Math.floor(diff / 86400000)

  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins} minute${mins === 1 ? '' : 's'} ago`
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`

  const timeStr = date.toLocaleTimeString('en-IN', { hour: '2-digit', minute: '2-digit', hour12: false })

  if (days === 1) return `Yesterday at ${timeStr}`

  const dateFormatted = date.toLocaleDateString('en-IN', { day: 'numeric', month: 'short' })
  return `${dateFormatted} at ${timeStr}`
}

/**
 * Format date for display
 */
export function formatDate(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-IN', {
    day: 'numeric', month: 'short', year: 'numeric',
  })
}

/**
 * Format date separator for conversation view
 */
export function dateSeparator(dateStr) {
  if (!dateStr) return ''
  return new Date(dateStr).toLocaleDateString('en-IN', {
    weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
  })
}

/**
 * Truncate string
 */
export function truncate(str, len = 60) {
  if (!str) return ''
  return str.length > len ? str.slice(0, len) + '…' : str
}

/**
 * Delta arrow and color
 */
export function deltaInfo(delta) {
  if (delta > 0) return { arrow: '↑', color: 'text-green-500', text: `+${delta}%` }
  if (delta < 0) return { arrow: '↓', color: 'text-red-500', text: `${delta}%` }
  return { arrow: '→', color: 'text-gray-400', text: '0%' }
}
