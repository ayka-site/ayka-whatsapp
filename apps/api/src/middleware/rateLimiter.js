const redis = require('../config/redis')
const logger = require('../utils/logger')

async function rateLimiter(req, res, next) {
  try {
    const businessId = req.tenant?.businessId
    const phone = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from

    if (!businessId || !phone) return next()

    const key = `ratelimit:${businessId}:${phone}`

    // Atomic pipeline: INCR + EXPIRE in a single HTTP round-trip.
    // Prevents the race where INCR creates the key but EXPIRE never runs
    // (e.g. process crash or Redis error between the two calls).
    // Using EXPIRE on every call makes this a sliding window — acceptable
    // for WhatsApp rate limiting and harder to game than a fixed window.
    const [count] = await redis.pipeline().incr(key).expire(key, 60).exec()

    req.isRateLimited = count > 25
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