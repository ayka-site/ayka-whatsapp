const redis = require('../config/redis')
const logger = require('../utils/logger')
const { normalizePhoneE164 } = require('../utils/phone')

const RATE_LIMIT = 20
const WINDOW_SECONDS = 60

async function rateLimiter(req, res, next) {
  try {
    const businessId = req.tenant?.businessId
    const rawPhone = req.body?.entry?.[0]?.changes?.[0]?.value?.messages?.[0]?.from
    const phone = normalizePhoneE164(rawPhone)

    if (!businessId || !phone) return next()

    const key = `ratelimit:${businessId}:${phone}`
    const nowMs = Date.now()
    const windowStartMs = nowMs - (WINDOW_SECONDS * 1000)

    // Sliding window in Redis sorted-set:
    // 1) remove old scores, 2) count current window, 3) add current msg, 4) ttl.
    await redis._client.zremrangebyscore(key, 0, windowStartMs)
    const currentCount = await redis._client.zcard(key)
    await redis._client.zadd(key, nowMs, `${nowMs}:${Math.random().toString(36).slice(2, 8)}`)
    await redis._client.expire(key, WINDOW_SECONDS + 5)

    const count = Number(currentCount) + 1
    req.normalizedPhone = phone
    req.isRateLimited = count > RATE_LIMIT
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
