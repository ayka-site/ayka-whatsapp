// Create a Pino logger instance.
// In development (NODE_ENV !== 'production') use pino-pretty transport 
// with colorize true.
// In production use default JSON output.
// Export the logger as default.
const pino = require('pino')

const logger = pino({
  redact: {
    paths: [
      'phone',
      '*.phone',
      '*.*.phone',
      'parentName',
      '*.parentName',
      'studentName',
      '*.studentName',
      'to',
      '*.to',
      'accessToken',
      '*.accessToken',
    ],
    censor: '[REDACTED]',
  },
  transport: process.env.NODE_ENV !== 'production' ? {
    target: 'pino-pretty',
    options: { colorize: true }
  } : undefined
})

module.exports = logger
