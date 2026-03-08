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
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'https://dashboard.ayka.site',
  'https://ayka.site',
]

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

  // Server-to-server/webhook requests usually have no Origin header.
  if (!origin) return cb(null, { origin: true, credentials: false })

  if (isPublicPath) return cb(null, { origin: true, credentials: false })
  if (ALLOWED_ORIGINS.includes(origin)) return cb(null, { origin: true, credentials: true })
  return cb(new Error('Origin not allowed by CORS'))
}

app.use(cors(buildCorsOptions))

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }))

// Static: serve embeddable widget JS
app.use('/widget/embed', express.static(path.join(__dirname, '../widget/dist')))

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
