// Create and export an Upstash Redis client using @upstash/redis package.
// Use Redis.fromEnv() to read UPSTASH_REDIS_REST_URL and UPSTASH_REDIS_REST_TOKEN
// from environment variables.
// Export the client as default named 'redis'.
const { Redis } = require('@upstash/redis')

const redis = Redis.fromEnv()
module.exports = redis
