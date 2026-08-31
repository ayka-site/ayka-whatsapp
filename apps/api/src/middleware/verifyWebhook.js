const crypto = require('crypto')
const logger = require('../utils/logger')

function verifyWebhook(req, res, next) {
  const skipSignature = String(process.env.SKIP_META_SIGNATURE_VERIFY || '').toLowerCase() === 'true'
  if (skipSignature && process.env.NODE_ENV !== 'production') return next()

  const signature = req.headers['x-hub-signature-256']
  if (!signature) {
    logger.warn({ path: req.path }, 'Meta webhook rejected: missing x-hub-signature-256 header')
    return res.sendStatus(401)
  }

  if (!process.env.META_APP_SECRET) {
    logger.error('Meta webhook rejected: META_APP_SECRET is not configured')
    return res.sendStatus(401)
  }

  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(req.rawBody) // rawBody set by express middleware
    .digest('hex')

  const trusted = Buffer.from(expectedSig, 'ascii')
  const received = Buffer.from(signature, 'ascii')

  if (trusted.length !== received.length ||
      !crypto.timingSafeEqual(trusted, received)) {
    logger.warn({ path: req.path }, 'Meta webhook rejected: invalid x-hub-signature-256 header')
    return res.sendStatus(401)
  }

  next()
}

module.exports = verifyWebhook
