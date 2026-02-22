// Write Express middleware using @upstash/redis to rate limit WhatsApp messages.
// Key format: ratelimit:{businessId}:{phone}
// Get businessId from req.tenant.businessId, phone from req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
// Allow max 10 requests per 60 seconds using Redis INCR and EXPIRE.
// If phone or businessId not available, call next() and skip.
// If over limit: call next() anyway (do not block — let handler send WhatsApp message back).
// Attach req.isRateLimited = true if over limit so the handler can check it.
// Import redis from '../config/redis'.
const redis = require('../config/redis')

async function rateLimiter(req, res, next) {
  try {
    const businessId = req.tenant?.businessId
    const phone = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from

    if (!businessId || !phone) return next()

    const key = `ratelimit:${businessId}:${phone}`
    const count = await redis.incr(key)

    if (count === 1) {
      await redis.expire(key, 60)
    }

    req.isRateLimited = count > 10
    next()
  } catch (err) {
    next(err)
  }
}

module.exports = rateLimiter