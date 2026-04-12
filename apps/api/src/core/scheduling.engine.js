/**
 * scheduling.engine.js - Visit scheduling and staff notification
 *
 * Architecture:
 *   Called from conversation.engine.js when LLM emits VISIT_CONFIRMED: YYYY-MM-DD HH:MM
 *   1. Checks vertical config has scheduling enabled
 *   2. Validates the LLM-resolved datetime (school hours, not in past, valid weekday)
 *   3. Creates an Appointment document in MongoDB
 *   4. Sends WhatsApp notification to staff with full details
 *   5. Returns the created appointment (or null if invalid / scheduling disabled)
 *
 * Design principles:
 *   1. Vertical-aware - only runs if vertical config has scheduling.enabled = true
 *   2. Idempotent - if an appointment already exists for this conversation, it's cancelled and replaced
 *   3. Staff notification follows same pattern as handoff.engine.js
 *   4. Fails gracefully - appointment creation failure does NOT block the parent's response
 *   5. Date/time validation uses real Date arithmetic, not regex guessing
 */

const { Appointment, KnowledgeBase } = require('@ayka/db')
const { sendTextMessage } = require('../services/whatsapp.service')
const logger = require('../utils/logger')

// ═════════════════════════════════════════════════════════════════════════════
// Vertical config registry - lazy-loaded, cached
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
// isSchedulingEnabled - check if vertical supports visit scheduling
// ═════════════════════════════════════════════════════════════════════════════
function isSchedulingEnabled(vertical) {
  const config = _loadVerticalConfig(vertical)
  return config?.scheduling?.enabled === true
}

// ═════════════════════════════════════════════════════════════════════════════
// _validateVisitDateTime - validate a "YYYY-MM-DD HH:MM" string from LLM
//
// Checks:
//   1. Format is correct
//   2. Day of week is Mon–Sat (not Sunday)
//   3. Time is within school hours: 09:00 – 14:00
//   4. Date is not in the past (based on current IST date)
//
// @param {string} visitDateTime  - e.g. "2026-03-10 10:00"
// @returns {{ valid: boolean, yr, mo, dy, hr, mn, reason }}
// ═════════════════════════════════════════════════════════════════════════════
function _validateVisitDateTime(visitDateTime) {
  if (!visitDateTime || typeof visitDateTime !== 'string') {
    return { valid: false, reason: 'missing' }
  }

  const match = visitDateTime.trim().match(/^(\d{4})-(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/)
  if (!match) {
    return { valid: false, reason: `malformed: "${visitDateTime}"` }
  }

  const [, yrS, moS, dyS, hrS, mnS] = match
  const yr = Number(yrS), mo = Number(moS), dy = Number(dyS)
  const hr = Number(hrS), mn = Number(mnS)

  // Day-of-week check (0=Sun … 6=Sat)
  // Use Date.UTC to avoid local-timezone shift when only date parts matter
  const dayOfWeek = new Date(yr, mo - 1, dy).getDay()
  if (dayOfWeek === 0) {
    return { valid: false, reason: 'Sunday - school is closed', yr, mo, dy, hr, mn }
  }

  // School hours: 09:00 – 14:00 IST
  const totalMinutes = hr * 60 + mn
  const opensAt  = 9  * 60  // 540
  const closesAt = 14 * 60  // 840
  if (totalMinutes < opensAt || totalMinutes > closesAt) {
    return { valid: false, reason: `outside school hours (${hr}:${String(mn).padStart(2,'0')} is not 09:00–14:00)`, yr, mo, dy, hr, mn }
  }

  // Past-date check - compare date strings lexicographically (YYYY-MM-DD sorts correctly)
  const nowIST = new Date(new Date().toLocaleString('en-US', { timeZone: 'Asia/Kolkata' }))
  const todayStr = `${nowIST.getFullYear()}-${String(nowIST.getMonth() + 1).padStart(2, '0')}-${String(nowIST.getDate()).padStart(2, '0')}`
  const visitDateStr = `${yrS}-${moS}-${dyS}`
  if (visitDateStr < todayStr) {
    return { valid: false, reason: `past date (${visitDateStr} < today ${todayStr})`, yr, mo, dy, hr, mn }
  }

  return { valid: true, yr, mo, dy, hr, mn, visitDateStr }
}

// ═════════════════════════════════════════════════════════════════════════════
// scheduleVisit - main public API
//
// @param {Object} session      - full session object (flowState, phone, etc.)
// @param {Object} tenant       - { businessId, resellerId, vertical, phoneNumberId, accessToken, settings }
// @param {string} visitDateTime - LLM-resolved datetime string, e.g. "2026-03-10 10:00"
// @returns {Object|null}       - created Appointment document, or null
// ═════════════════════════════════════════════════════════════════════════════
async function scheduleVisit(session, tenant, visitDateTime) {
  const vertical = tenant.vertical

  // Gate: vertical must have scheduling enabled
  if (!isSchedulingEnabled(vertical)) {
    logger.info({ vertical }, 'Scheduling not enabled for this vertical - skipping')
    return null
  }

  const config    = _loadVerticalConfig(vertical)
  const collected = session.flowState?.collectedData || {}
  const phone     = session.phone

  // Validate the LLM-resolved datetime
  const validation = _validateVisitDateTime(visitDateTime)
  if (!validation.valid) {
    logger.warn({ visitDateTime, phone, reason: validation.reason }, 'Visit datetime invalid - skipping appointment creation')
    return null
  }

  const { yr, mo, dy, hr, mn, visitDateStr } = validation
  const scheduledDate = visitDateStr                          // "2026-03-10"
  const scheduledTime = `${String(hr).padStart(2,'0')}:${String(mn).padStart(2,'0')}`  // "10:00"

  // Cancel any existing appointment for this conversation (rescheduling scenario)
  try {
    await Appointment.updateMany(
      { conversationId: session.conversationId, status: 'confirmed' },
      { $set: { status: 'cancelled' } }
    )
  } catch (err) {
    logger.warn({ err }, 'Failed to cancel previous appointments - continuing')
  }

  // Documents from vertical config
  const documentsAdvised = config?.scheduling?.documentsRequired || []

  // Persist a normalized slot string so timelines never store relative words
  // like "kal/parso/monday" in appointment timing fields.
  const rawPreference = `${scheduledDate} ${scheduledTime}`

  // Create the appointment
  let appointment
  try {
    appointment = await Appointment.create({
      businessId:      tenant.businessId,
      resellerId:      tenant.resellerId,
      conversationId:  session.conversationId,
      contactId:       session.contactId,
      phone,
      parentName:      collected.parentName  || null,
      studentName:     collected.studentName || null,
      interestedClass: collected.interestedClass || null,
      scheduledDate,
      scheduledTime,
      rawPreference,
      status:          'confirmed',
      documentsAdvised,
    })
    logger.info({ appointmentId: appointment._id, phone, scheduledDate, scheduledTime }, 'Visit appointment created')
  } catch (err) {
    logger.error({ err, phone }, 'Failed to create appointment')
    return null
  }

  // Notify staff via WhatsApp
  await _notifyStaff(session, tenant, appointment, config).catch(err =>
    logger.error({ err }, 'Staff visit notification failed - appointment still created')
  )

  return appointment
}

// ═════════════════════════════════════════════════════════════════════════════
// _notifyStaff - send WhatsApp message to staff about the new appointment
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
    logger.warn({ businessId: tenant.businessId }, 'No staffPhone configured - skipping visit notification')
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
  const altPhone    = session.flowState?.collectedData?.altPhone
  const contactLine = altPhone ? `${parentPhone} (alt: ${altPhone})` : parentPhone

  // Show both the resolved datetime and the natural-language preference
  const visitDisplay = `${appointment.scheduledDate} at ${appointment.scheduledTime}`
  const rawNote      = appointment.rawPreference && appointment.rawPreference !== `${appointment.scheduledDate} ${appointment.scheduledTime}`
    ? ` (parent said: "${appointment.rawPreference}")`
    : ''

  const visitHours = config?.scheduling?.visitHours || '9 AM – 2 PM, Mon–Sat'
  const docs = (appointment.documentsAdvised || []).length > 0
    ? appointment.documentsAdvised.join(', ')
    : 'None specified'

  const message = isHindi
    ? `📅 Naya Visit Booking\n\nParent: ${parentName || 'Unknown'}\nStudent: ${studentName || 'N/A'}\nClass: ${interestedClass || 'N/A'}\nVisit: ${visitDisplay}${rawNote}\nContact: ${contactLine}\nDocuments: ${docs}\n\nWhatsApp chatbot ne visit confirm kiya hai. Visit hours: ${visitHours}`
    : `📅 New Visit Booking\n\nParent: ${parentName || 'Unknown'}\nStudent: ${studentName || 'Not provided'}\nClass: ${interestedClass || 'Not mentioned'}\nVisit: ${visitDisplay}${rawNote}\nContact: ${contactLine}\nDocuments: ${docs}\n\nVisit confirmed by WhatsApp chatbot. Visit hours: ${visitHours}`

  await sendTextMessage(staffPhone, message, tenant.phoneNumberId, tenant.accessToken)

  // Mark appointment as staff-notified
  await Appointment.updateOne(
    { _id: appointment._id },
    { $set: { staffNotified: true, staffNotifiedAt: new Date() } }
  ).catch(err => logger.warn({ err }, 'Failed to mark appointment as notified'))

  logger.info({ staffPhone, appointmentId: appointment._id }, 'Staff notified about visit')
}

module.exports = { scheduleVisit, isSchedulingEnabled }
