const required = [
  'MONGODB_URI',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'META_APP_SECRET',
  'GROQ_API_KEY',
  'ENCRYPTION_KEY',
  'NODE_ENV'
]

function validateEnv() {
  const missing = required.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }
}

module.exports = { validateEnv }
