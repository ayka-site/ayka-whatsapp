// Express app entry point.
// require('dotenv').config() first.
// Import validateEnv from './src/config/env' and call it immediately.
// Import connectDB from './src/config/db' and call it.
// Import logger from './src/utils/logger'.
// Set up Express with:
//   - express.json() BUT capture rawBody for webhook signature verification:
//     app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }))
//   - Mount health router at '/'
//   - Mount webhook router at '/'
//   - Global error handler: (err, req, res, next) => log err, return 500 { error: 'Internal server error' }
// Listen on process.env.PORT || 3000.
// Log 'AyKa API running on port X' on start.
// Import routes from './src/routes/health.routes' and './src/routes/webhook.routes'.
require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const { validateEnv } = require('./src/config/env')
const { connectDB } = require('./src/config/db')
const logger = require('./src/utils/logger')

process.on('unhandledRejection', (reason) => {
  logger.error({ reason }, 'Unhandled promise rejection')
})

process.on('uncaughtException', (err) => {
  logger.error({ err }, 'Uncaught exception')
})

validateEnv()
connectDB()

const app = express()

// CORS — dashboard origins are restricted; widget/webhook paths allow any origin
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'https://dashboard.ayka.site',
  'https://ayka.site',
  'https://www.ayka.site',
]
const CORS_ALLOW_ALL = String(process.env.CORS_ALLOW_ALL || '').trim().toLowerCase() === 'true'

/**
 * normalizeOrigin - Return canonical origin or null if invalid.
 * @param {string} value - Raw origin value.
 * @returns {string|null} Canonical origin.
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
 * parseAllowedOrigins - Build exact and wildcard origin allowlists from env + defaults.
 * Supports wildcard entries like "https://*.azurestaticapps.net".
 * @returns {{ allowAll: boolean, exact: Set<string>, wildcards: Array<{ protocol: string|null, suffix: string }> }}
 */
function parseAllowedOrigins() {
  const envOrigins = String(process.env.ALLOWED_ORIGINS || '')
    .split(',')
    .map(o => o.trim())
    .filter(Boolean)
  const merged = [...DEFAULT_ALLOWED_ORIGINS, ...envOrigins]
  const exact = new Set()
  const wildcards = []

  for (const raw of merged) {
    if (raw === '*') return { allowAll: true, exact, wildcards }

    const wildcardMatch = raw.match(/^(https?:\/\/)?\*\.(.+)$/i)
    if (wildcardMatch) {
      const protocol = wildcardMatch[1] || null
      const domain = wildcardMatch[2].toLowerCase()
      wildcards.push({
        protocol: protocol ? protocol.toLowerCase() : null,
        suffix: `.${domain}`,
      })
      continue
    }

    const normalized = normalizeOrigin(raw)
    if (normalized) exact.add(normalized)
  }

  return { allowAll: false, exact, wildcards }
}

const ORIGIN_RULES = parseAllowedOrigins()

/**
 * isOriginAllowed - Validate request origin against configured CORS rules.
 * @param {string} origin - Raw request Origin header.
 * @returns {boolean} True when allowed.
 */
function isOriginAllowed(origin) {
  if (CORS_ALLOW_ALL || ORIGIN_RULES.allowAll) return true
  const normalized = normalizeOrigin(origin)
  if (!normalized) return false
  if (ORIGIN_RULES.exact.has(normalized)) return true

  try {
    const url = new URL(normalized)
    return ORIGIN_RULES.wildcards.some(rule => {
      if (rule.protocol && rule.protocol !== url.protocol) return false
      return url.hostname.endsWith(rule.suffix)
    })
  } catch (err) {
    return false
  }
}

/**
 * buildCorsOptions - Resolve CORS policy per request path.
 * @param {import('express').Request} req - Incoming request.
 * @param {Function} cb - CORS callback.
 * @returns {void} Calls callback with CORS options or error.
 */
function buildCorsOptions(req, cb) {
  const origin = req.header('Origin')
  const isPublicPath = req.path.startsWith('/widget')
    || req.path === '/health'
    || req.path.startsWith('/webhook/whatsapp')
    || req.path.startsWith('/assets')

  // Server-to-server/webhook requests usually have no Origin header.
  if (!origin) return cb(null, { origin: true, credentials: false })

  if (isPublicPath) return cb(null, { origin: true, credentials: false })
  if (isOriginAllowed(origin)) return cb(null, { origin: true, credentials: true })
  return cb(new Error('Origin not allowed by CORS'))
}

app.use(cors(buildCorsOptions))

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }))

// Static: serve embeddable widget JS
app.use('/widget/embed', express.static(path.join(__dirname, '../widget/dist')))

// Static: serve public assets (QR images, etc.) — no auth required, public CORS
app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }))

// Existing routes
app.use('/', require('./src/routes/health.routes'))
app.use('/', require('./src/routes/webhook.routes'))

// Widget routes (public — no JWT)
app.use('/widget', require('./src/routes/widget.routes'))

// Dashboard API routes
app.use('/api/auth', require('./src/routes/auth.routes'))
app.use('/api/client', require('./src/routes/client.routes'))
app.use('/api/admin', require('./src/routes/admin.routes'))
app.use('/api/superadmin', require('./src/routes/superadmin.routes'))

app.use((err, req, res, next) => {
  if (err?.message === 'Origin not allowed by CORS') {
    return res.status(403).json({ error: 'Origin not allowed' })
  }
  logger.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  logger.info(`AyKa API running on port ${PORT}`)
})
