const pino = require('pino')

const logger = pino({
  level: process.env.LOG_LEVEL || 'info',
  redact: {
    paths: ['phone', '*.phone', 'parentName', '*.parentName', 'studentName', '*.studentName', 'to', '*.to', 'accessToken', '*.accessToken'],
    censor: '[REDACTED]',
  },
  transport: process.env.NODE_ENV !== 'production'
    ? { target: 'pino-pretty', options: { colorize: true } }
    : undefined
})

module.exports = logger
