require('dotenv').config()
const express = require('express')
const cors = require('cors')
const path = require('path')
const Redis = require('ioredis')
const { Business } = require('@ayka/db')
const { decrypt } = require('./src/utils/encryption')
const { sendTextMessage } = require('./src/services/whatsapp.service')
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

// CORS - dashboard origins are restricted; widget/webhook paths allow any origin
const DEFAULT_ALLOWED_ORIGINS = [
  'http://localhost:3001',
  'https://dashboard.ayka.site',
  'https://aykabot.ayka.site',
  'https://ayka.site',
  'https://www.ayka.site',
]
const CORS_ALLOW_ALL = String(process.env.CORS_ALLOW_ALL || '').trim().toLowerCase() === 'true'

function normalizeOrigin(value) {
  const input = String(value || '').trim()
  if (!input) return null
  try {
    return new URL(input).origin
  } catch (err) {
    return null
  }
}

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

function buildCorsOptions(req, cb) {
  const origin = req.header('Origin')
  const isPublicPath = req.path.startsWith('/widget')
    || req.path === '/health'
    || req.path.startsWith('/webhook/whatsapp')
    || req.path.startsWith('/assets')

  if (!origin) return cb(null, { origin: true, credentials: false })

  if (isPublicPath) return cb(null, { origin: true, credentials: false })
  if (isOriginAllowed(origin)) return cb(null, { origin: true, credentials: true })
  return cb(new Error('Origin not allowed by CORS'))
}

app.use(cors(buildCorsOptions))

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }))

app.use('/widget/embed', express.static(path.join(__dirname, '../widget/dist')))
app.use('/assets', express.static(path.join(__dirname, 'public'), { maxAge: '7d' }))

app.use('/', require('./src/routes/health.routes'))
app.use('/', require('./src/routes/webhook.routes'))

app.use('/widget', require('./src/routes/widget.routes'))

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

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const outboundSubscriber = new Redis(REDIS_URL)

async function resolveTenantForOutbound(phoneNumberId) {
  const redis = require('./src/config/redis')
  const cacheKey = `tenant:${phoneNumberId}`
  const cached = await redis.get(cacheKey)
  if (cached?.accessToken && cached?.phoneNumberId) {
    return cached
  }

  const business = await Business.findOne(
    { 'whatsapp.phoneNumberId': phoneNumberId, isActive: true },
    {
      _id: 1,
      vertical: 1,
      settings: 1,
      'whatsapp.accessToken': 1,
      'whatsapp.phoneNumberId': 1,
    },
  ).lean()

  if (!business?.whatsapp?.accessToken || !business?.whatsapp?.phoneNumberId) {
    return null
  }

  const tenant = {
    businessId: business._id.toString(),
    vertical: business.vertical,
    settings: business.settings,
    accessToken: decrypt(business.whatsapp.accessToken),
    phoneNumberId: business.whatsapp.phoneNumberId,
  }

  await redis.set(cacheKey, JSON.stringify(tenant), { ex: 600 })
  return tenant
}

outboundSubscriber.on('error', (err) => {
  logger.error({ err }, 'WhatsApp outbound bridge subscriber error')
})

outboundSubscriber.subscribe('ayka:whatsapp:outbound', (err) => {
  if (err) {
    logger.error({ err }, 'Failed to subscribe ayka:whatsapp:outbound')
    return
  }
  logger.info('Subscribed to ayka:whatsapp:outbound')
})

outboundSubscriber.on('message', (channel, payload) => {
  if (channel !== 'ayka:whatsapp:outbound') return

  Promise.resolve()
    .then(async () => {
      const event = JSON.parse(payload)
      if (!(event?.to && event?.text && event?.phoneNumberId)) return

      const tenant = await resolveTenantForOutbound(String(event.phoneNumberId))
      if (!tenant?.accessToken) {
        logger.warn({ phoneNumberId: event.phoneNumberId }, 'No tenant token for outbound WhatsApp bridge message')
        return
      }

      await sendTextMessage(
        String(event.to),
        String(event.text),
        String(event.phoneNumberId),
        tenant.accessToken,
      )
    })
    .catch((err) => {
      logger.error({ err }, 'Failed processing ayka:whatsapp:outbound message')
    })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  logger.info(`AyKa API running on port ${PORT}`)
})
