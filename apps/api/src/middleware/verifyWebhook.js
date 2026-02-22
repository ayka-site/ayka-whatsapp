const crypto = require('crypto')

function verifyWebhook(req, res, next) {
  const signature = req.headers['x-hub-signature-256']
  if (!signature) return res.sendStatus(401)

  const expectedSig = 'sha256=' + crypto
    .createHmac('sha256', process.env.META_APP_SECRET)
    .update(req.rawBody) // rawBody set by express middleware
    .digest('hex')

  const trusted = Buffer.from(expectedSig, 'ascii')
  const received = Buffer.from(signature, 'ascii')

  if (trusted.length !== received.length ||
      !crypto.timingSafeEqual(trusted, received)) {
    return res.sendStatus(401)
  }

  next()
}

module.exports = verifyWebhook
