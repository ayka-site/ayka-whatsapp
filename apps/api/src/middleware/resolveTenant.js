const redis = require('../config/redis')
const { Business } = require('@ayka/db')
const { decrypt } = require('../utils/encryption')
const logger = require('../utils/logger')

async function resolveTenant(req, res, next) {
  try {
    const entry = req.body?.entry?.[0]
    const change = entry?.changes?.[0]
    const phoneNumberId = change?.value?.metadata?.phone_number_id

    if (!phoneNumberId) return res.sendStatus(200)

    const cacheKey = `tenant:${phoneNumberId}`
    const cached = await redis.get(cacheKey)

    if (cached) {
      req.tenant = typeof cached === 'string' ? JSON.parse(cached) : cached
      return next()
    }

    const business = await Business.findOne(
      { 'whatsapp.phoneNumberId': phoneNumberId, isActive: true },
      { _id:1, resellerId:1, vertical:1, settings:1,
        'whatsapp.accessToken':1, 'whatsapp.phoneNumberId':1 }
    ).lean()

    if (!business) {
      logger.warn({ phoneNumberId }, 'No business found for phoneNumberId')
      return res.sendStatus(200)
    }

    const tenant = {
      businessId:    business._id.toString(),
      resellerId:    business.resellerId?.toString(),
      vertical:      business.vertical,
      settings:      business.settings,
      accessToken:   business.whatsapp.accessToken,
      phoneNumberId: business.whatsapp.phoneNumberId
    }

    // Upstash syntax: { ex: seconds } NOT 'EX', seconds
    await redis.set(cacheKey, JSON.stringify(tenant), { ex: 600 })
    req.tenant = tenant
    next()
  } catch (err) {
    logger.error({ err }, err.message)
    res.sendStatus(500)
  }
}

module.exports = resolveTenant
