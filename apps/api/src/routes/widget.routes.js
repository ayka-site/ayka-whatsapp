const express = require('express')
const router = express.Router()
const crypto = require('crypto')
const jwt = require('jsonwebtoken')
const { Business } = require('@ayka/db')
const { processWebMessage } = require('../core/web.conversation.engine')
const logger = require('../utils/logger')

/**
 * widget.routes.js - Public API for embeddable web chat widget
 *
 * Endpoints (NO JWT auth - these are public-facing):
 *   GET  /widget/config/:businessId  - widget config (theme, welcome msg, etc.)
 *   POST /widget/init                - generate unique visitorId
 *   POST /widget/message             - send message, get AI response
 *
 * Security:
 *   - Rate limiting per visitor (20 msg/min)
 *   - Origin allowlist checking
 *   - Business must be active + widget enabled
 *   - Message length validation
 */

// ── CORS middleware for widget (allow cross-origin embedding) ──
router.use((req, res, next) => {
  const origin = req.headers.origin || ''
  if (origin) {
    res.header('Access-Control-Allow-Origin', origin)
    res.header('Access-Control-Allow-Credentials', 'true')
    res.header('Vary', 'Origin')
  } else {
    res.header('Access-Control-Allow-Origin', '*')
  }
  res.header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
  res.header('Access-Control-Allow-Headers', 'Content-Type, X-Requested-With')
  res.header('Access-Control-Max-Age', '86400')
  if (req.method === 'OPTIONS') return res.sendStatus(204)
  next()
})

// ── Simple in-memory rate limiter (20 messages per minute per visitor) ──
const rateLimitMap = new Map()
const RATE_LIMIT   = 20
const RATE_WINDOW  = 60 * 1000 // 1 minute
const WIDGET_SESSION_TTL_SECONDS = 180 * 24 * 60 * 60

function parseCookies(req) {
  const raw = req.headers?.cookie || ''
  const out = {}
  if (!raw) return out
  raw.split(';').forEach(part => {
    const [k, ...rest] = part.split('=')
    const key = (k || '').trim()
    if (!key) return
    out[key] = decodeURIComponent((rest.join('=') || '').trim())
  })
  return out
}

function getWidgetSessionCookieName(businessId) {
  return `ayka_ws_${String(businessId)}`
}

function getWidgetSessionSecret() {
  return process.env.WIDGET_SESSION_SECRET || process.env.JWT_SECRET || process.env.ENCRYPTION_KEY || 'ayka-widget-dev-secret'
}

function getCookieSecurityMode(req) {
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || '').toLowerCase()
  return proto.includes('https')
}

function issueWidgetSessionCookie(req, res, businessId, visitorId) {
  const token = jwt.sign({ businessId: String(businessId), visitorId }, getWidgetSessionSecret(), {
    expiresIn: WIDGET_SESSION_TTL_SECONDS,
  })

  const secure = getCookieSecurityMode(req)
  const sameSite = secure ? 'None' : 'Lax'
  const parts = [
    `${getWidgetSessionCookieName(businessId)}=${encodeURIComponent(token)}`,
    'Path=/',
    'HttpOnly',
    `Max-Age=${WIDGET_SESSION_TTL_SECONDS}`,
    `SameSite=${sameSite}`,
  ]
  if (secure) parts.push('Secure')
  res.append('Set-Cookie', parts.join('; '))
}

function readWidgetSessionVisitorId(req, businessId) {
  const cookies = parseCookies(req)
  const token = cookies[getWidgetSessionCookieName(businessId)]
  if (!token) return null

  try {
    const decoded = jwt.verify(token, getWidgetSessionSecret())
    if (decoded?.businessId !== String(businessId)) return null
    if (!decoded?.visitorId || typeof decoded.visitorId !== 'string') return null
    return decoded.visitorId
  } catch (_) {
    return null
  }
}

function resolveVisitorId(req, businessId) {
  const fromCookie = readWidgetSessionVisitorId(req, businessId)
  if (fromCookie) return { visitorId: fromCookie, mode: 'cookie' }

  const fromBody = String(req.body?.visitorId || '').trim()
  if (/^v_[a-f0-9]{32}$/i.test(fromBody)) {
    return { visitorId: fromBody, mode: 'body_fallback' }
  }

  return { visitorId: null, mode: 'missing' }
}

/**
 * normalizeOrigin - Canonicalize an origin string for secure comparison.
 * @param {string} value - Raw origin or URL value.
 * @returns {string|null} Normalized origin (scheme+host+port) or null if invalid.
 */
function normalizeOrigin(value) {
  const input = String(value || '').trim()
  if (!input) return null
  try {
    return new URL(input).origin
  } catch (err) {
    return null
  }
}

/**
 * isWidgetOriginAllowed - Check request origin against business widget allowlist.
 * @param {object} business - Business document containing widget.allowedOrigins.
 * @param {string} requestOrigin - Origin or referer header from request.
 * @returns {boolean} True when origin is allowed or allowlist is empty.
 */
function isWidgetOriginAllowed(business, requestOrigin) {
  const origins = business?.widget?.allowedOrigins || []
  if (origins.length === 0) return true
  const requestOriginNorm = normalizeOrigin(requestOrigin)
  const allowedOriginSet = new Set(origins.map(normalizeOrigin).filter(Boolean))
  return requestOriginNorm ? allowedOriginSet.has(requestOriginNorm) : false
}

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
// GET /widget/config/:businessId - Returns widget configuration (public)
// ═══════════════════════════════════════════════════════════════════
router.get('/config/:businessId', async (req, res) => {
  try {
    const business = await Business.findById(req.params.businessId,
      { widget: 1, name: 1, vertical: 1, settings: 1 }
    ).lean()

    if (!business) return res.status(404).json({ error: 'Business not found' })
    if (!business.widget?.enabled) return res.status(404).json({ error: 'Widget not enabled' })

    // Origin allowlist check
    const requestOrigin = req.headers.origin || req.headers.referer || ''
    if (!isWidgetOriginAllowed(business, requestOrigin)) return res.status(403).json({ error: 'Origin not allowed' })

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
// POST /widget/init - Generate unique visitor ID
// ═══════════════════════════════════════════════════════════════════
router.post('/init', async (req, res) => {
  try {
    const businessId = String(req.body?.businessId || '').trim()
    if (!businessId) return res.status(400).json({ error: 'businessId required' })

    const business = await Business.findById(businessId, { widget: 1, isActive: 1 }).lean()
    if (!business || !business.isActive) return res.status(404).json({ error: 'Business not found' })
    if (!business.widget?.enabled) return res.status(404).json({ error: 'Widget not enabled' })
    const requestOrigin = req.headers.origin || req.headers.referer || ''
    if (!isWidgetOriginAllowed(business, requestOrigin)) return res.status(403).json({ error: 'Origin not allowed' })

    const visitorId = `v_${crypto.randomBytes(16).toString('hex')}`
    issueWidgetSessionCookie(req, res, businessId, visitorId)
    res.json({ visitorId, sessionMode: 'cookie' })
  } catch (err) {
    logger.error({ err }, 'Widget init error')
    res.status(500).json({ error: 'Internal server error' })
  }
})

// ═══════════════════════════════════════════════════════════════════
// POST /widget/message - Send message, get AI response
// ═══════════════════════════════════════════════════════════════════
router.post('/message', async (req, res) => {
  try {
    const businessId = String(req.body?.businessId || '').trim()
    const message = String(req.body?.message || '')
    const visitorInfo = req.body?.visitorInfo || {}

    if (!businessId || !message) {
      return res.status(400).json({ error: 'businessId and message are required' })
    }

    const trimmedMessage = message.trim()
    if (!trimmedMessage) {
      return res.status(400).json({ error: 'message cannot be empty' })
    }
    if (trimmedMessage.length > 2000) {
      return res.status(400).json({ error: 'Message must be a string under 2000 characters' })
    }

    const { visitorId, mode: visitorIdMode } = resolveVisitorId(req, businessId)
    if (!visitorId) {
      return res.status(401).json({
        error: 'Widget session missing. Reinitialize widget and retry.',
        code: 'WIDGET_SESSION_MISSING',
      })
    }

    // Rate limit check
    if (!checkRateLimit(visitorId)) {
      return res.status(429).json({ error: 'Too many messages. Please wait a moment.' })
    }

    const business = await Business.findById(businessId, {
      isActive: 1,
      widget: 1,
    }).lean()
    if (!business || !business.isActive) return res.status(404).json({ error: 'Business not found' })
    if (!business.widget?.enabled) return res.status(404).json({ error: 'Widget not enabled' })
    const requestOrigin = req.headers.origin || req.headers.referer || ''
    if (!isWidgetOriginAllowed(business, requestOrigin)) return res.status(403).json({ error: 'Origin not allowed' })

    if (visitorIdMode === 'body_fallback') {
      logger.warn({ businessId, visitorId }, 'Widget message accepted via body visitorId fallback')
      issueWidgetSessionCookie(req, res, businessId, visitorId)
    }

    const result = await processWebMessage(businessId, visitorId, trimmedMessage, visitorInfo)

    if (result?.error) {
      return res.status(502).json({
        error: 'Unable to process message right now. Please retry.',
        code: 'WIDGET_PROCESSING_FAILED',
      })
    }

    res.json({
      response:       result.response,
      conversationId: result.conversationId,
      source:         'web_widget',
      sessionMode:    visitorIdMode === 'cookie' ? 'cookie' : 'cookie_rehydrated',
      timestamp:      new Date().toISOString(),
    })
  } catch (err) {
    logger.error({ err }, 'Widget message error')
    res.status(500).json({ error: 'Something went wrong. Please try again.' })
  }
})

module.exports = router
