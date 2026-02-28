const required = [
  'MONGODB_URI',
  'UPSTASH_REDIS_REST_URL',
  'UPSTASH_REDIS_REST_TOKEN',
  'META_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'GROQ_API_KEY',
  'ENCRYPTION_KEY',
  'NODE_ENV'
]

function validateEnv() {
  const missing = required.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }

  // ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256-CBC)
  const encKey = process.env.ENCRYPTION_KEY
  if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }
}

module.exports = { validateEnv }
