const redis = require('../config/redis')
const logger = require('../utils/logger')

async function rateLimiter(req, res, next) {
  try {
    const businessId = req.tenant?.businessId
    const phone = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from

    if (!businessId || !phone) return next()

    const key = `ratelimit:${businessId}:${phone}`

    // Fixed-window rate limiter: INCR the key, set TTL only on first message.
    // The old sliding-window reset EXPIRE on every message, so the counter
    // grew indefinitely during active conversations (never expired).
    // Now the 60-second window starts when the first message arrives and
    // resets naturally — no matter how many messages come in that window.
    const count = await redis._client.incr(key)
    if (count === 1) await redis._client.expire(key, 60)

    req.isRateLimited = count > 40
    req.rateLimitCount = count
    next()
  } catch (err) {
    // Do NOT call next(err) — that propagates a 500 to Express's error handler
    // which returns a non-2xx to Meta and causes it to retry the webhook.
    logger.warn({ err }, 'rateLimiter Redis error — allowing request through')
    next()
  }
}

module.exports = rateLimiter