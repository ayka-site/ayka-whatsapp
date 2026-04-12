const express = require('express')
const router  = express.Router()
const verifyWebhook  = require('../middleware/verifyWebhook')
const resolveTenant  = require('../middleware/resolveTenant')
const rateLimiter    = require('../middleware/rateLimiter')
const { handleWhatsAppWebhook } = require('../webhooks/whatsapp.handler')

// GET - Meta webhook verification (no auth needed)
router.get('/webhook/whatsapp', (req, res) => {
  const mode      = req.query['hub.mode']
  const token     = req.query['hub.verify_token']
  const challenge = req.query['hub.challenge']

  if (mode === 'subscribe' && token === process.env.META_WEBHOOK_VERIFY_TOKEN) {
    return res.status(200).send(challenge)
  }
  res.sendStatus(403)
})

// POST - incoming messages (middleware chain: verify → resolve tenant → rate limit → handle)
router.post('/webhook/whatsapp',
  verifyWebhook,
  resolveTenant,
  rateLimiter,
  handleWhatsAppWebhook
)

module.exports = router
