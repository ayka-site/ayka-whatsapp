const redis = require('../config/redis')
const { Business } = require('@ayka/db')

async function resolveTenant(req, res, next) {
  try {
    const entry = req.body?.entry?.[0]
    const change = entry?.changes?.[0]
    const phoneNumberId = change?.value?.metadata?.phone_number_id

    if (!phoneNumberId) return res.sendStatus(400)

    const cacheKey = `tenant:${phoneNumberId}`
    const cached = await redis.get(cacheKey)

    if (cached) {
      req.tenant = JSON.parse(cached)
      return next()
    }

    const business = await Business.findOne(
      { 'whatsapp.phoneNumberId': phoneNumberId, isActive: true },
      { _id:1, resellerId:1, vertical:1, settings:1,
        'whatsapp.accessToken':1, 'whatsapp.phoneNumberId':1 }
    ).lean()

    if (!business) return res.sendStatus(404)

    const tenant = {
      businessId:    business._id.toString(),
      resellerId:    business.resellerId.toString(),
      vertical:      business.vertical,
      settings:      business.settings,
      accessToken:   decrypt(business.whatsapp.accessToken),
      phoneNumberId: business.whatsapp.phoneNumberId
    }

    await redis.set(cacheKey, JSON.stringify(tenant), 'EX', 3600)
    req.tenant = tenant
    next()
  } catch (err) {
    next(err)
  }
}

module.exports = resolveTenant
