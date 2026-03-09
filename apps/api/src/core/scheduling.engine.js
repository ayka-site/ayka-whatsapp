/**
 * scheduling.engine.js — Visit scheduling and staff notification
 *
 * Architecture:
 *   Called from conversation.engine.js when LLM emits VISIT_CONFIRMED: YES
 *   1. Checks vertical config has scheduling enabled
 *   2. Creates an Appointment document in MongoDB
 *   3. Sends WhatsApp notification to staff with full details
 *   4. Returns the created appointment (or null if scheduling disabled)
 *
 * Design principles:
 *   1. Vertical-aware — only runs if vertical config has scheduling.enabled = true
 *   2. Idempotent — if an appointment already exists for this conversation, it's cancelled and replaced
 *   3. Staff notification follows same pattern as handoff.engine.js
 *   4. Fails gracefully — appointment creation failure does NOT block the parent's response
 */

const { Appointment, KnowledgeBase } = require('@ayka/db')
const { sendTextMessage } = require('../services/whatsapp.service')
const logger = require('../utils/logger')

// ═════════════════════════════════════════════════════════════════════════════
// Vertical config registry — lazy-loaded, cached
// ═════════════════════════════════════════════════════════════════════════════
const _configCache = {}

function _loadVerticalConfig(vertical) {
  if (_configCache[vertical]) return _configCache[vertical]
  try {
    const config = require(`../verticals/${vertical}/config`)
    _configCache[vertical] = config
    return config
  } catch (err) {
    logger.warn({ err, vertical }, 'Vertical config not found for scheduling')
    return null
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// isSchedulingEnabled — check if vertical supports visit scheduling
// ═════════════════════════════════════════════════════════════════════════════
function isSchedulingEnabled(vertical) {
  const config = _loadVerticalConfig(vertical)
  return config?.scheduling?.enabled === true
}

/**
 * _isWithinVisitHoursNowIST - Check whether current IST time is within Mon-Sat 9 AM-2 PM.
 * @returns {boolean} True when current IST falls within valid visit window.
 */
function _isWithinVisitHoursNowIST() {
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = nowIST.getDay() // 0=Sun, 1=Mon ... 6=Sat
  const minutes = (nowIST.getHours() * 60) + nowIST.getMinutes()
  const opensAt = 9 * 60
  const closesAt = 14 * 60
  return day >= 1 && day <= 6 && minutes >= opensAt && minutes < closesAt
}

/**
 * _isTodayVisitStillPossibleNowIST - Check if same-day visit can still fit in today's window.
 * @returns {boolean} True when today is Mon-Sat and current IST time is before 2:00 PM.
 */
function _isTodayVisitStillPossibleNowIST() {
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const day = nowIST.getDay() // 0=Sun, 1=Mon ... 6=Sat
  const minutes = (nowIST.getHours() * 60) + nowIST.getMinutes()
  const closesAt = 14 * 60
  return day >= 1 && day <= 6 && minutes < closesAt
}

/**
 * _minutesFromVisitTimeToken - Parse natural time token to minutes since midnight.
 * @param {string} token - Parsed visit time token like "1:30 pm" or "11 baje".
 * @returns {number|null} Minutes since midnight in IST context, or null when unparseable.
 */
function _minutesFromVisitTimeToken(token) {
  const t = String(token || '')
    .trim()
    .toLowerCase()
    .replace(/\s*(?:tk|tak)\b/g, '')
    .trim()
  if (!t) return null
  if (t === 'morning' || t === 'subah') return 10 * 60
  if (t === 'afternoon' || t === 'dopahar') return 12 * 60

  const match = t.match(/\b(\d{1,2})(?::([0-5]\d))?\s*(am|pm|baje)?\b/)
  if (!match) return null

  const hour = Number.parseInt(match[1], 10)
  const minute = Number.parseInt(match[2] || '0', 10)
  const marker = match[3] || ''
  if (!Number.isFinite(hour) || hour < 1 || hour > 12 || !Number.isFinite(minute)) return null

  if (marker === 'am') {
    const normalizedHour = hour % 12
    return (normalizedHour * 60) + minute
  }
  if (marker === 'pm') {
    const normalizedHour = (hour % 12) + 12
    return (normalizedHour * 60) + minute
  }

  // No AM/PM marker (or "baje" without AM/PM context) is ambiguous;
  // infer typical school-visit usage in 12-hour format:
  // 9-11 => morning, 12-2 => day-time, 3-8 => evening.
  if (hour >= 9 && hour <= 11) return (hour * 60) + minute
  if (hour === 12) return (12 * 60) + minute
  if (hour === 1) return (13 * 60) + minute
  if (hour === 2) return (14 * 60) + minute
  if (hour >= 3 && hour <= 8) return ((hour + 12) * 60) + minute

  return null
}

/**
 * _isValidVisitTimeToken - Validate parsed time token against school visit hours.
 * @param {string} token - Parsed visit time token from user preference.
 * @returns {boolean} True when token falls in Mon-Sat allowed time window (9:00 to 2:00 inclusive).
 */
function _isValidVisitTimeToken(token) {
  const minutes = _minutesFromVisitTimeToken(token)
  if (!Number.isFinite(minutes)) return false
  const opensAt = 9 * 60
  const closesAtInclusive = 14 * 60
  return minutes >= opensAt && minutes <= closesAtInclusive
}

// ═════════════════════════════════════════════════════════════════════════════
// scheduleVisit — main public API
//
// @param {Object} session    — full session object (flowState, phone, etc.)
// @param {Object} tenant     — { businessId, resellerId, vertical, phoneNumberId, accessToken, settings }
// @returns {Object|null}     — created Appointment document, or null
// ═════════════════════════════════════════════════════════════════════════════
async function scheduleVisit(session, tenant) {
  const vertical = tenant.vertical

  // Gate: vertical must have scheduling enabled
  if (!isSchedulingEnabled(vertical)) {
    logger.info({ vertical }, 'Scheduling not enabled for this vertical — skipping')
    return null
  }

  const config    = _loadVerticalConfig(vertical)
  const collected = session.flowState?.collectedData || {}
  const phone     = session.phone

  // Parse visit time components from the raw preference
  const rawPreference  = collected.preferredVisitTime || 'Not specified'
  const { date, time } = _parseVisitComponents(rawPreference)

  // ── Server-side operating hours validation ──
  // School hours: 9 AM – 2 PM, Mon–Sat. Reject clearly invalid times.
  const invalidTimeMarkers = /raat|night|sunday|itwar|itwaar|evening|shaam|sham|midnight/i
  const immediateNowPattern = /\b(abhi|right\s*now|now|immediately|turant|isi\s*waqt)\b/i
  const todayPattern = /\b(today|aaj)\b/i
  const asksForImmediateNow = immediateNowPattern.test(rawPreference)
  const asksForToday = todayPattern.test(rawPreference)
  const missingTime = !time
  const hasOutOfWindowTime = time ? !_isValidVisitTimeToken(time) : true
  if (
    missingTime ||
    invalidTimeMarkers.test(rawPreference) ||
    hasOutOfWindowTime ||
    (asksForImmediateNow && !_isWithinVisitHoursNowIST()) ||
    (asksForToday && !_isTodayVisitStillPossibleNowIST())
  ) {
    logger.warn({ rawPreference, phone }, 'Visit time invalid or outside operating hours — skipping appointment creation')
    return null
  }

  // Cancel any existing appointment for this conversation (rescheduling scenario)
  try {
    await Appointment.updateMany(
      { conversationId: session.conversationId, status: 'confirmed' },
      { $set: { status: 'cancelled' } }
    )
  } catch (err) {
    logger.warn({ err }, 'Failed to cancel previous appointments — continuing')
  }

  // Documents from vertical config
  const documentsAdvised = config?.scheduling?.documentsRequired || []

  // Create the appointment
  let appointment
  try {
    appointment = await Appointment.create({
      businessId:      tenant.businessId,
      resellerId:      tenant.resellerId,
      conversationId:  session.conversationId,
      contactId:       session.contactId,
      phone,
      parentName:      collected.parentName || null,
      studentName:     collected.studentName || null,
      interestedClass: collected.interestedClass || null,
      scheduledDate:   date,
      scheduledTime:   time,
      rawPreference,
      status:          'confirmed',
      documentsAdvised,
    })
    logger.info({ appointmentId: appointment._id, phone }, 'Visit appointment created')
  } catch (err) {
    logger.error({ err, phone }, 'Failed to create appointment')
    return null
  }

  // Notify staff via WhatsApp
  await _notifyStaff(session, tenant, appointment, config).catch(err =>
    logger.error({ err }, 'Staff visit notification failed — appointment still created')
  )

  return appointment
}

// ═════════════════════════════════════════════════════════════════════════════
// _notifyStaff — send WhatsApp message to staff about the new appointment
// ═════════════════════════════════════════════════════════════════════════════
async function _notifyStaff(session, tenant, appointment, config) {
  // Resolve staff phone (same logic as handoff.engine.js)
  let staffPhone = tenant.settings?.handoffPhone || null
  if (!staffPhone) {
    try {
      const kb = await KnowledgeBase.findOne(
        { businessId: tenant.businessId },
        { 'content.handoff': 1 }
      ).lean()
      staffPhone = kb?.content?.handoff?.staffPhone || null
    } catch (kbErr) {
      logger.warn({ kbErr }, 'Could not load KB for staff phone')
    }
  }

  if (!staffPhone) {
    logger.warn({ businessId: tenant.businessId }, 'No staffPhone configured — skipping visit notification')
    return
  }

  // Detect language from recent messages
  const recentUserMsgs = (session.recentMessages || [])
    .filter(m => m.role === 'user')
    .slice(-3)
    .map(m => m.content?.text || '')
    .join(' ')
    .toLowerCase()

  const hindiWords = ['hai', 'hain', 'kya', 'mein', 'chahiye', 'batao', 'ke', 'ka', 'ki', 'se', 'ho']
  const hindiCount = hindiWords.filter(w => recentUserMsgs.includes(w)).length
  const isHindi = hindiCount >= 2

  const { parentName, studentName, interestedClass, phone: parentPhone } = appointment
  const altPhone   = session.flowState?.collectedData?.altPhone
  const contactLine = altPhone ? `${parentPhone} (alt: ${altPhone})` : parentPhone

  const visitHours = config?.scheduling?.visitHours || '9 AM – 2 PM, Mon–Sat'
  const docs = (appointment.documentsAdvised || []).length > 0
    ? appointment.documentsAdvised.join(', ')
    : 'None specified'

  const message = isHindi
    ? `📅 Naya Visit Booking\n\nParent: ${parentName || 'Unknown'}\nStudent: ${studentName || 'N/A'}\nClass: ${interestedClass || 'N/A'}\nVisit: ${appointment.rawPreference}\nContact: ${contactLine}\nDocuments: ${docs}\n\nWhatsApp chatbot ne visit confirm kiya hai. Visit hours: ${visitHours}`
    : `📅 New Visit Booking\n\nParent: ${parentName || 'Unknown'}\nStudent: ${studentName || 'Not provided'}\nClass: ${interestedClass || 'Not mentioned'}\nVisit: ${appointment.rawPreference}\nContact: ${contactLine}\nDocuments: ${docs}\n\nVisit confirmed by WhatsApp chatbot. Visit hours: ${visitHours}`

  await sendTextMessage(staffPhone, message, tenant.phoneNumberId, tenant.accessToken)

  // Mark appointment as staff-notified
  await Appointment.updateOne(
    { _id: appointment._id },
    { $set: { staffNotified: true, staffNotifiedAt: new Date() } }
  ).catch(err => logger.warn({ err }, 'Failed to mark appointment as notified'))

  logger.info({ staffPhone, appointmentId: appointment._id }, 'Staff notified about visit')
}

// ═════════════════════════════════════════════════════════════════════════════
// _parseVisitComponents — split raw preference into date and time parts
// ═════════════════════════════════════════════════════════════════════════════
function _parseVisitComponents(raw) {
  if (!raw) return { date: null, time: null }
  const s = raw.toLowerCase().trim()

  // Date-like tokens
  const dateMatch = s.match(/\b(today|tomorrow|monday|tuesday|wednesday|thursday|friday|saturday|sunday|kal|aaj|parso)\b/i)
  // Time-like tokens
  const timeMatch = s.match(/\b(morning|afternoon|evening|subah|dopahar|shaam|\d{1,2}:\d{2}\s*(?:am|pm|baje)?(?:\s*(?:tk|tak))?|\d{1,2}\s*(?:am|pm|baje))\b/i)

  return {
    date: dateMatch ? dateMatch[0].trim() : null,
    time: timeMatch ? timeMatch[0].trim() : null,
  }
}

module.exports = { scheduleVisit, isSchedulingEnabled }
