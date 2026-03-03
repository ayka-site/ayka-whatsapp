const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const { Business } = require('@ayka/db')
const { processWebMessage } = require('../core/web.conversation.engine')
const logger = require('../utils/logger')

/**
 * widget.routes.js — Public API for embeddable web chat widget
 *
 * Endpoints (NO JWT auth — these are public-facing):
 *   GET  /widget/config/:businessId  — widget config (theme, welcome msg, etc.)
 *   POST /widget/init                — generate unique visitorId
 *   POST /widget/message             — send message, get AI response
 *
 * Security:
 *   - Rate limiting per visitor (20 msg/min)
 *   - Origin allowlist checking
 *   - Business must be active + widget enabled
 *   - Message length validation
 */

// ── CORS middleware for widget (allow cross-origin embedding) ──
router.use((req, res, next) => {
  const origin = req.headers.origin || '*'
  res.header('Access-Control-Allow-Origin', origin)
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type')
  res.header('Access-Control-Max-Age', '86400')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ── Simple in-memory rate limiter (20 messages per minute per visitor) ──
const rateLimitMap = new Map()
const RATE_LIMIT   = 20
const RATE_WINDOW  = 60 * 1000 // 1 minute

function checkRateLimit(visitorId) {
  const now = Date.now()
  const entry = rateLimitMap.get(visitorId)
  if (!entry || now - entry.windowStart > RATE_WINDOW) {
    rateLimitMap.set(visitorId, { count: 1, windowStart: now })
    return true
  }
  if (entry.count >= RATE_LIMIT) return false
  entry.count++
  return true
}

// Cleanup stale entries every 2 minutes
setInterval(() => {
  const now = Date.now()
  for (const [id, entry] of rateLimitMap) {
    if (now - entry.windowStart > RATE_WINDOW * 2) rateLimitMap.delete(id)
  }
}, 2 * 60 * 1000)

// ═══════════════════════════════════════════════════════════════════
// GET /widget/config/:businessId — Returns widget configuration (public)
// ═══════════════════════════════════════════════════════════════════
router.get('/config/:businessId', async (req, res) => {
  try {
    const business = await Business.findById(req.params.businessId,
      { widget: 1, name: 1, vertical: 1, settings: 1 }
    ).lean()

    if (!business) return res.status(404).json({ error: 'Business not found' })
    if (!business.widget?.enabled) return res.status(404).json({ error: 'Widget not enabled' })

    // Origin allowlist check
    const origins = business.widget.allowedOrigins || []
    if (origins.length > 0) {
      const requestOrigin = req.headers.origin || req.headers.referer || ''
      const allowed = origins.some(o => requestOrigin.startsWith(o))
      if (!allowed) return res.status(403).json({ error: 'Origin not allowed' })
    }

    res.json({
      businessId:     business._id,
      agentName:      business.widget.agentName || business.settings?.displayName || 'AI Assistant',
      agentAvatar:    business.widget.agentAvatar || null,
      brandName:      business.widget.brandName || business.name,
      welcomeMessage: business.widget.welcomeMessage || 'Hi there! How can I help you today?',
      placeholder:    business.widget.placeholder || 'Type a message…',
      position:       business.widget.position || 'bottom-right',
      theme:          business.widget.theme || {},
      poweredBy:      business.widget.poweredBy !== false,
      collectName:    business.widget.collectName !== false,
      collectEmail:   !!business.widget.collectEmail,
      collectPhone:   !!business.widget.collectPhone,
    })
  } catch (err) {
    logger.error({ err }, 'Widget config error')
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ═══════════════════════════════════════════════════════════════════
// POST /widget/init — Generate unique visitor ID
// ═══════════════════════════════════════════════════════════════════
router.post('/init', async (req, res) => {
  try {
    const { businessId } = req.body
    if (!businessId) return res.status(400).json({ error: 'businessId required' })

    const business = await Business.findById(businessId, { widget: 1, isActive: 1 }).lean()
    if (!business || !business.isActive) return res.status(404).json({ error: 'Business not found' })
    if (!business.widget?.enabled) return res.status(404).json({ error: 'Widget not enabled' })

    const visitorId = `v_${crypto.randomBytes(16).toString('hex')}`
    res.json({ visitorId })
  } catch (err) {
    logger.error({ err }, 'Widget init error')
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ═══════════════════════════════════════════════════════════════════
// POST /widget/message — Send message, get AI response
// ═══════════════════════════════════════════════════════════════════
router.post('/message', async (req, res) => {
  try {
    const { businessId, visitorId, message, visitorInfo } = req.body

    if (!businessId || !visitorId || !message) {
      return res.status(400).json({ error: 'businessId, visitorId, and message are required' })
    }

    if (typeof message !== 'string' || message.length > 2000) {
      return res.status(400).json({ error: 'Message must be a string under 2000 characters' })
    }

    // Rate limit check
    if (!checkRateLimit(visitorId)) {
      return res.status(429).json({ error: 'Too many messages. Please wait a moment.' })
    }

    const result = await processWebMessage(businessId, visitorId, message.trim(), visitorInfo || {})

    res.json({
      response:       result.response,
      conversationId: result.conversationId,
      timestamp:      new Date().toISOString(),
    })
  } catch (err) {
    logger.error({ err }, 'Widget message error')
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

module.exports = router
