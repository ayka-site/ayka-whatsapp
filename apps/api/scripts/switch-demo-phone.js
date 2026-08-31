#!/usr/bin/env node
/**
 * Move one shared Meta/Facebook test phone number between demo tenants.
 *
 * Examples:
 *   DEMO_SLUG=buildsworth-cadd-centre WA_PHONE_NUMBER_ID=123 WA_ACCESS_TOKEN=EAAG... node scripts/switch-demo-phone.js
 *   node scripts/switch-demo-phone.js ayka-realty-demo
 *   node scripts/switch-demo-phone.js sant-pathik-vidyalaya
 *
 * The selected tenant receives WA_PHONE_NUMBER_ID. Any other tenant currently
 * holding that same number is moved to a deterministic inactive demo id so the
 * unique phoneNumberId index is preserved.
 */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env.production') })
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: true })
require('dotenv').config()

const mongoose = require('mongoose')
const { Business } = require('@ayka/db')
const { encrypt, decrypt } = require('../src/utils/encryption')

const DEMO_SLUG_ALIASES = {
  spv: 'sant-pathik-vidyalaya',
  school: 'sant-pathik-vidyalaya',
  'spv-school': 'sant-pathik-vidyalaya',
  education: 'buildsworth-cadd-centre',
  buildsworth: 'buildsworth-cadd-centre',
  realestate: 'ayka-realty-demo',
  real_estate: 'ayka-realty-demo',
  realty: 'ayka-realty-demo',
}

function resolveSlug(input) {
  const raw = String(input || '').trim()
  return DEMO_SLUG_ALIASES[raw] || raw
}

function isEncryptedToken(value) {
  if (!value || typeof value !== 'string') return false
  const parts = value.split(':')
  return parts.length === 3 && parts.every(part => /^[0-9a-f]+$/i.test(part))
}

function placeholderPhoneId(business) {
  return `DEMO_OFFLINE_${business.slug}_${String(business._id).slice(-8)}`
}

async function validateMetaToken(accessToken) {
  if (!accessToken) return

  const response = await fetch(
    `https://graph.facebook.com/debug_token?input_token=${encodeURIComponent(accessToken)}&access_token=${encodeURIComponent(accessToken)}`,
  )
  const data = await response.json().catch(() => ({}))

  if (!response.ok || data?.error || data?.data?.is_valid === false) {
    const message = data?.error?.message || data?.data?.error?.message || 'Meta token validation failed'
    throw new Error(`Invalid WA_ACCESS_TOKEN: ${message}`)
  }
}

async function clearTenantCache(phoneNumberIds) {
  const ids = [...new Set(phoneNumberIds.filter(Boolean))]
  if (ids.length === 0) return
  try {
    const redis = require('../src/config/redis')
    for (const id of ids) {
      await redis.del(`tenant:${id}`)
      console.log(`Cleared Redis cache: tenant:${id}`)
    }
    redis._client?.disconnect?.()
  } catch (err) {
    console.warn('Could not clear Redis tenant cache:', err.message)
  }
}

async function main() {
  const selectedSlug = resolveSlug(process.argv[2] || process.env.DEMO_SLUG || process.env.DEMO_TENANT)
  const phoneNumberId = process.env.WA_PHONE_NUMBER_ID
  const accessToken = process.env.WA_ACCESS_TOKEN
  const wabaId = process.env.WA_WABA_ID
  const verifyToken = process.env.WA_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN

  if (!selectedSlug) {
    console.error('Usage: DEMO_SLUG=<slug|spv|buildsworth|realestate> WA_PHONE_NUMBER_ID=<id> [WA_ACCESS_TOKEN=<token>] node scripts/switch-demo-phone.js')
    process.exit(1)
  }
  if (!phoneNumberId) {
    console.error('WA_PHONE_NUMBER_ID is required. Use the Meta test phone number id you want to route now.')
    process.exit(1)
  }
  if (accessToken && !process.env.ENCRYPTION_KEY) {
    console.error('ENCRYPTION_KEY is required when WA_ACCESS_TOKEN is provided.')
    process.exit(1)
  }
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGODB_URI)
  await validateMetaToken(accessToken)

  const selected = await Business.findOne(
    selectedSlug === 'sant-pathik-vidyalaya'
      ? { $or: [{ slug: 'sant-pathik-vidyalaya' }, { slug: 'spv-school' }, { name: { $regex: /sant\\s*pathik/i } }] }
      : { slug: selectedSlug },
  )
  if (!selected) {
    console.error(`No business found for slug: ${selectedSlug}`)
    const businesses = await Business.find({}, { name: 1, slug: 1, vertical: 1 }).sort({ slug: 1 }).lean()
    if (businesses.length > 0) {
      console.error('Available tenants:')
      for (const business of businesses) {
        console.error(`- ${business.slug} (${business.vertical}) - ${business.name}`)
      }
    }
    console.error('Seed the tenant first, then rerun this switch script.')
    process.exit(1)
  }

  const cacheIds = [phoneNumberId, selected.whatsapp?.phoneNumberId]
  const conflicts = await Business.find({
    _id: { $ne: selected._id },
    'whatsapp.phoneNumberId': phoneNumberId,
  })

  for (const conflict of conflicts) {
    const replacement = placeholderPhoneId(conflict)
    cacheIds.push(conflict.whatsapp?.phoneNumberId, replacement)
    await Business.updateOne(
      { _id: conflict._id },
      { $set: { 'whatsapp.phoneNumberId': replacement } },
    )
    console.log(`Moved ${conflict.slug} off shared phone id -> ${replacement}`)
  }

  const update = { 'whatsapp.phoneNumberId': phoneNumberId }
  if (accessToken) update['whatsapp.accessToken'] = encrypt(accessToken)
  if (wabaId) update['whatsapp.wabaId'] = wabaId
  if (verifyToken) update['whatsapp.verifyToken'] = verifyToken

  await Business.updateOne({ _id: selected._id }, { $set: update })

  const updated = await Business.findById(selected._id).lean()
  if (accessToken) {
    const decrypted = decrypt(updated.whatsapp.accessToken)
    if (decrypted !== accessToken) throw new Error('Encrypted token round-trip failed')
  } else if (!isEncryptedToken(updated.whatsapp.accessToken)) {
    console.warn('Selected tenant token does not look encrypted. Provide WA_ACCESS_TOKEN to update it safely.')
  }

  await clearTenantCache(cacheIds)
  await mongoose.disconnect()

  console.log('\n✅ Demo phone routing updated')
  console.log(`Active tenant: ${updated.name}`)
  console.log(`Slug: ${updated.slug}`)
  console.log(`Vertical: ${updated.vertical}`)
  console.log(`Phone number id: ${updated.whatsapp.phoneNumberId}`)
  console.log(accessToken ? 'Access token: updated and encrypted' : 'Access token: left unchanged')
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
