const required = [
  'MONGODB_URI',
  'META_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'ENCRYPTION_KEY',
  'NODE_ENV',
  'JWT_SECRET'
]

function validateEnv() {
  const missing = required.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }

  // Azure OpenAI is required for the LLM service
  if (!process.env.AZURE_OPENAI_KEY) {
    throw new Error('AZURE_OPENAI_KEY is required for the LLM service')
  }

  // ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes for AES-256-CBC)
  const encKey = process.env.ENCRYPTION_KEY
  if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }
}

module.exports = { validateEnv }
