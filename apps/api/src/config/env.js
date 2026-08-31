const required = [
  'MONGODB_URI',
  'META_APP_SECRET',
  'META_WEBHOOK_VERIFY_TOKEN',
  'ENCRYPTION_KEY',
  'NODE_ENV',
  'JWT_SECRET',
]

function validateLLMEnvironment() {
  const provider = String(process.env.LLM_PROVIDER || 'openrouter').trim().toLowerCase()
  const genericKey = process.env.LLM_API_KEY

  if (provider === 'openrouter') {
    if (!genericKey && !process.env.OPENROUTER_API_KEY) {
      throw new Error('OPENROUTER_API_KEY (or LLM_API_KEY) is required when LLM_PROVIDER=openrouter')
    }
    return
  }

  if (provider === 'openai') {
    if (!genericKey && !process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY (or LLM_API_KEY) is required when LLM_PROVIDER=openai')
    }
    return
  }

  // Any other provider is treated as an OpenAI-compatible endpoint configured
  // by LLM_BASE_URL + LLM_API_KEY. This keeps model/provider switching out of
  // application code.
  if (!process.env.LLM_BASE_URL) {
    throw new Error(`LLM_BASE_URL is required for custom LLM_PROVIDER=${provider}`)
  }
  if (!genericKey) {
    throw new Error(`LLM_API_KEY is required for custom LLM_PROVIDER=${provider}`)
  }
}

function validateEnv() {
  const missing = required.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }

  validateLLMEnvironment()

  // AES-256 key used to encrypt/decrypt tenant WhatsApp credentials.
  const encKey = process.env.ENCRYPTION_KEY
  if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes). Generate one with: node -e "console.log(require(\'crypto\').randomBytes(32).toString(\'hex\'))"')
  }
}

module.exports = { validateEnv }
