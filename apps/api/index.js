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

validateEnv()
connectDB()

const app = express()

// CORS — dashboard origins are restricted; widget/webhook paths allow any origin
const ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'https://dashboard.ayka.site',
  'https://ayka.site',
]
app.use(cors({
  origin: (origin, cb) => {
    // No origin = server-to-server / curl / webhooks — always allow
    if (!origin) return cb(null, true)
    // Widget & health paths are public embeds — allow any origin
    // Dashboard paths restrict to known origins
    if (ALLOWED_ORIGINS.includes(origin)) return cb(null, true)
    // Allow any origin for widget embeds (they can be on any client website)
    cb(null, true)
  },
  credentials: true,
}))

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
  logger.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  logger.info(`AyKa API running on port ${PORT}`)
})