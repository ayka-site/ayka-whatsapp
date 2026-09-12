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
  } else if (provider === 'openai') {
    if (!genericKey && !process.env.OPENAI_API_KEY) {
      throw new Error('OPENAI_API_KEY (or LLM_API_KEY) is required when LLM_PROVIDER=openai')
    }
  } else {
    if (!process.env.LLM_BASE_URL) {
      throw new Error(`LLM_BASE_URL is required for custom LLM_PROVIDER=${provider}`)
    }
    if (!genericKey) {
      throw new Error(`LLM_API_KEY is required for custom LLM_PROVIDER=${provider}`)
    }
  }

  if (process.env.NODE_ENV === 'production') {
    const explicitModels = [
      'LLM_RESPONSE_MODEL',
      'LLM_UNDERSTANDING_MODEL',
      'LLM_VALIDATION_MODEL',
      'LLM_EMBEDDING_MODEL',
    ]
    const missingModels = explicitModels.filter(key => !String(process.env[key] || '').trim())
    if (missingModels.length) {
      throw new Error(`Production requires explicit AI model configuration: ${missingModels.join(', ')}`)
    }

    if (provider === 'openrouter') {
      const collection = String(process.env.OPENROUTER_DATA_COLLECTION || '').trim().toLowerCase()
      if (collection !== 'deny') {
        throw new Error('Production OpenRouter traffic requires OPENROUTER_DATA_COLLECTION=deny')
      }
    }
  }
}

function validateEnv() {
  const missing = required.filter(key => !process.env[key])
  if (missing.length > 0) {
    throw new Error(`Missing required env vars: ${missing.join(', ')}`)
  }

  validateLLMEnvironment()

  const encKey = process.env.ENCRYPTION_KEY
  if (!/^[0-9a-fA-F]{64}$/.test(encKey)) {
    throw new Error('ENCRYPTION_KEY must be exactly 64 hex characters (32 bytes)')
  }

  const graphVersion = String(process.env.WHATSAPP_GRAPH_API_VERSION || 'v25.0').trim()
  if (!/^v\d+\.\d+$/.test(graphVersion)) {
    throw new Error('WHATSAPP_GRAPH_API_VERSION must look like v25.0')
  }
}

module.exports = { validateEnv, _private: { validateLLMEnvironment } }
