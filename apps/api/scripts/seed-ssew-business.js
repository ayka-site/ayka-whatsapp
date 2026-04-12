#!/usr/bin/env node
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env.production') })
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
require('dotenv').config()

const mongoose = require('mongoose')
const { Business } = require('@ayka/db')
const { encrypt } = require('../src/utils/encryption')

async function main() {
  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error('MONGODB_URI is required.')
    process.exit(1)
  }

  const phoneNumberId = process.env.SSEW_WA_PHONE_NUMBER_ID || process.env.WHATSAPP_PHONE_ID
  const accessToken = process.env.SSEW_WA_ACCESS_TOKEN || process.env.WHATSAPP_TOKEN
  const wabaId = process.env.SSEW_WA_WABA_ID
  const verifyToken =
    process.env.SSEW_WA_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || 'ssew_verify_token'

  if (!(phoneNumberId && accessToken && wabaId)) {
    console.error(
      'SSEW_WA_PHONE_NUMBER_ID, SSEW_WA_ACCESS_TOKEN, SSEW_WA_WABA_ID are required (or WHATSAPP_PHONE_ID/WHATSAPP_TOKEN fallback).',
    )
    process.exit(1)
  }

  await mongoose.connect(mongoUri)
  console.log('Connected to MongoDB')

  const encryptedToken = encrypt(accessToken)

  const result = await Business.findOneAndUpdate(
    { slug: 'ssew' },
    {
      $set: {
        name: 'S.S. Engineering Works',
        slug: 'ssew',
        vertical: 'msme',
        isActive: true,
        whatsapp: {
          phoneNumberId,
          accessToken: encryptedToken,
          wabaId,
          verifyToken,
        },
        settings: {
          displayName: 'S.S. Engineering Works',
          agentName: 'AyKa BOS',
          timezone: 'Asia/Kolkata',
          language: 'en',
          handoffPhone: '+919818489414',
          dashboardHandoffReplyEnabled: false,
          allowPaidReplies: false,
        },
      },
      $setOnInsert: {
        resellerId: null,
        subscription: { plan: 'starter', status: 'active' },
      },
    },
    { new: true, upsert: true },
  )

  console.log(`SSEW business ready: ${result._id}`)
  console.log(`Phone Number ID: ${result.whatsapp.phoneNumberId}`)

  await mongoose.disconnect()
}

main().catch(async (err) => {
  console.error(err)
  try {
    await mongoose.disconnect()
  } catch {
    // no-op
  }
  process.exit(1)
})
