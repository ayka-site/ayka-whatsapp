const required = [
  'MONGODB_URI',
  'META_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'ENCRYPTION_KEY',
  'NODE_ENV'
]

function validateEnv() {
  const missing = required.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }

  // At least one LLM provider must be configured
  const hasGemini = !!process.env.GEMINI_API_KEY
  const hasGroq   = !!(process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY)
  if (!hasGemini && !hasGroq) {
    throw new Error('At least one LLM provider required: set GEMINI_API_KEY or GROQ_API_KEYS/GROQ_API_KEY')
  }

  // ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256-CBC)
  const encKey = process.env.ENCRYPTION_KEY
  if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }
}

module.exports = { validateEnv }
