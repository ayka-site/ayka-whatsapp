// Redis client using ioredis (TCP) — self-hosted on Azure VM.
// Wraps ioredis to be API-compatible with the old Upstash REST client
// so that all consumers (session.service, rateLimiter, etc.) work unchanged.
const Redis = require('ioredis')
const logger = require('../utils/logger')

const REDIS_URL = process.env.REDIS_URL || 'redis://localhost:6379'
const REDIS_PASSWORD = process.env.REDIS_PASSWORD || undefined

const ioClient = new Redis(REDIS_URL, {
  password: REDIS_PASSWORD,
  maxRetriesPerRequest: 3,
  retryStrategy: (times) => Math.min(times * 200, 5000),
  lazyConnect: false,
})

ioClient.on('connect', () => logger.info('Redis connected'))
ioClient.on('error', (err) => logger.error({ err }, 'Redis connection error'))

// ── Upstash-compatible wrapper ──
// Upstash uses:  redis.set(key, val, { ex: 600, nx: true })
// ioredis uses:  redis.set(key, val, 'EX', 600, 'NX')
const redis = {
  async get(key) {
    const val = await ioClient.get(key)
    if (val === null) return null
    try {
      return JSON.parse(val)
    } catch (parseErr) {
      logger.warn({ parseErr, key }, 'Redis value is not JSON; returning raw string')
      return val
    }
  },

  async set(key, value, opts = {}) {
    const serialized = typeof value === 'string' ? value : JSON.stringify(value)
    const args = [key, serialized]
    if (opts.ex) args.push('EX', opts.ex)
    if (opts.px) args.push('PX', opts.px)
    if (opts.nx) args.push('NX')
    const result = await ioClient.set(...args)
    // Upstash returns null when NX fails, ioredis returns null too — compatible
    return result
  },

  async del(key) {
    return ioClient.del(key)
  },

  // Pipeline wrapper — Upstash pipeline().cmd().cmd().exec() returns array of results
  pipeline() {
    const pipe = ioClient.pipeline()
    return {
      incr(key) { pipe.incr(key); return this },
      expire(key, seconds) { pipe.expire(key, seconds); return this },
      get(key) { pipe.get(key); return this },
      set(key, val, ...rest) { pipe.set(key, val, ...rest); return this },
      del(key) { pipe.del(key); return this },
      async exec() {
        const results = await pipe.exec()
        // ioredis pipeline returns [[err, result], ...]
        // Upstash pipeline returns [result, ...]
        return results.map(([err, val]) => {
          if (err) throw err
          return val
        })
      },
    }
  },

  // Expose raw client for any future direct usage
  _client: ioClient,
}

module.exports = redis
