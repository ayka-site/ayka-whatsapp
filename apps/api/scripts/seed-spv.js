#!/usr/bin/env node
/**
 * seed-spv.js — Onboard SPV School (Production)
 *
 * Creates:
 *   1. Sant Pathik Vidyalaya (SPV) Business document
 *   2. Knowledge Base with all courses, fees, FAQ, and policies
 *   3. Dashboard user: admin@spvschool.in (role: client)
 *
 * Run (dev/local):
 *   node scripts/seed-spv.js
 *
 * Run (production Atlas):
 *   MONGODB_URI="$(grep MONGODB_URI .env.production | cut -d= -f2-)" node scripts/seed-spv.js
 *
 * WhatsApp credentials (set via env when ready):
 *   WA_PHONE_NUMBER_ID=1021773934354033
 *   WA_ACCESS_TOKEN=<real-token>
 *   WA_WABA_ID=918233131133295
 *   WA_VERIFY_TOKEN=<your-verify-token>
 */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env.production') })
require('dotenv').config({ path: path.resolve(__dirname, '../.env') })
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')
const crypto   = require('crypto')
const { Business, KnowledgeBase, User, Reseller } = require('@ayka/db')

const ADMIN_EMAIL    = process.env.SPV_ADMIN_EMAIL    || 'admin@spvschool.in'
const ADMIN_PASSWORD = process.env.SPV_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url')

async function main() {
  const mongoUri = process.env.MONGODB_URI
  if (!mongoUri) {
    console.error('❌ MONGODB_URI not found.')
    console.error(`Checked: ${path.resolve(__dirname, '../.env.production')} and ${path.resolve(__dirname, '../.env')}`)
    console.error('You can also run: MONGODB_URI="<mongo-uri>" node ayka/apps/api/scripts/seed-spv.js')
    process.exit(1)
  }

  await mongoose.connect(mongoUri)
  console.log('Connected to MongoDB\n')

  // ── 1. Resolve reseller (WellTechUp) ──
  const reseller = await Reseller.findOne({ slug: 'welltechup' })
  if (!reseller) {
    console.error('WellTechUp reseller not found. Run seed-dashboard.js first.')
    process.exit(1)
  }
  console.log(`Reseller: ${reseller.name} (${reseller._id})`)

  // ── 2. Create or update Business ──
  let business = await Business.findOne({
    $or: [
      { slug: 'sant-pathik-vidyalaya' },
      { slug: 'spv-school' },
      { name: { $regex: /sant\s*pathik/i } },
    ],
  })
  const waPhoneNumberId = process.env.WA_PHONE_NUMBER_ID || '1021773934354033'
  const waAccessToken   = process.env.WA_ACCESS_TOKEN
  const waWabaId        = process.env.WA_WABA_ID         || '918233131133295'
  const waVerifyToken   = process.env.WA_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || 'spv_webhook_secret_2026'

  if (!business && !waAccessToken) {
    console.error('❌ WA_ACCESS_TOKEN is required for SPV onboarding.')
    console.error('Set WA_ACCESS_TOKEN in environment or apps/api/.env.production')
    process.exit(1)
  }

  // If another business already holds this phoneNumberId, archive it to avoid unique index conflicts.
  if (business) {
    const conflict = await Business.findOne({
      'whatsapp.phoneNumberId': waPhoneNumberId,
      _id: { $ne: business._id },
    })

    if (conflict) {
      const archivedPhoneId = `archived-${String(conflict._id)}`
      await Business.updateOne(
        { _id: conflict._id },
        {
          $set: {
            isActive: false,
            name: `${conflict.name} (Archived Duplicate)`,
            'whatsapp.phoneNumberId': archivedPhoneId,
          },
        }
      )
      console.log(`⚠️  Archived conflicting business: ${conflict.name} (${conflict._id})`)
    }
  }

  if (!business) {
    business = await Business.create({
      resellerId: reseller._id,
      name:       'Sant Pathik Vidyalaya',
      slug:       'sant-pathik-vidyalaya',
      vertical:   'school',
      whatsapp: {
        phoneNumberId: waPhoneNumberId,
        accessToken:   waAccessToken,
        wabaId:        waWabaId,
        verifyToken:   waVerifyToken,
      },
      settings: {
        displayName:  'Sant Pathik Vidyalaya',
        agentName:    'Riya',
        timezone:     'Asia/Kolkata',
        language:     'hi',
        handoffPhone: '+919198783830',
      },
      subscription: { plan: 'pro', status: 'active' },
      isActive: true,
    })
    console.log(`✅ Created Business: ${business.name} (${business._id})`)
  } else {
    // Force migration to new SPV WhatsApp number/account IDs
    const update = {
      name: 'Sant Pathik Vidyalaya',
      slug: 'sant-pathik-vidyalaya',
      'settings.agentName':    'Riya',
      'settings.displayName':  'Sant Pathik Vidyalaya',
      'settings.handoffPhone': '+919198783830',
      'whatsapp.phoneNumberId': waPhoneNumberId,
      'whatsapp.wabaId': waWabaId,
      'whatsapp.verifyToken': waVerifyToken,
      resellerId: reseller._id,
    }
    if (waAccessToken) update['whatsapp.accessToken'] = waAccessToken
    await Business.updateOne({ _id: business._id }, { $set: update })
    console.log(`ℹ️  Business already exists — updated: ${business.name} (${business._id})`)
  }

  // ── 3. Knowledge Base ──
  const kbContent = {
    // Institute identity
    about: {
      name:    'Sant Pathik Vidyalaya',
      address: 'Bahraich, Uttar Pradesh',
      phone:   '9198783830',
      website: 'spvschool.in',
    },

    // Staff / contact
    staff: {
      phone:        '9198783830',
      workingHours: '9:00 AM – 7:00 PM, Monday to Saturday',
      directorName: 'Principal',
      directorPhone: '9198783830',
    },

    // Operating hours
    timing: {
      schoolHours: '9:00 AM – 7:00 PM, Monday to Saturday',
    },

    // Teaching modes
    teachingModes: ['Offline', 'Hybrid'],

    // Courses
    courses: [
      {
        name:           'Primary Education',
        targetAudience: 'School students (Classes 1–8)',
        highlights: [
          'Holistic development',
          'Modern teaching methods',
          'Extracurricular activities',
        ],
        modes:    'Offline, Hybrid',
        duration: '1 year',
        fees:     'As per school policy',
      },
      {
        name:           'Secondary Education',
        targetAudience: 'School students (Classes 9–12)',
        highlights: [
          'Science, Commerce, Arts streams',
          'Competitive exam preparation',
          'Sports and cultural events',
        ],
        modes:    'Offline, Hybrid',
        duration: '1 year',
        fees:     'As per school policy',
      },
    ],
  }

  // Create or update Knowledge Base
  let kb = await KnowledgeBase.findOne({ businessId: business._id })
  if (!kb) {
    kb = await KnowledgeBase.create({
      businessId: business._id,
      resellerId: reseller._id,
      vertical: 'school',
      content: kbContent,
      version: 1,
      isActive: true,
    })
    console.log(`✅ Created KnowledgeBase: ${kb._id}`)
  } else {
    await KnowledgeBase.updateOne(
      { _id: kb._id },
      {
        $set: {
          content: kbContent,
          resellerId: reseller._id,
          vertical: 'school',
          isActive: true,
          version: (kb.version || 0) + 1,
        },
      }
    )
    console.log(`ℹ️  Updated existing KnowledgeBase: ${kb._id} (version ${(kb.version || 0) + 1})`)
  }

  // ── 4. Dashboard User ──
  let user = await User.findOne({ email: ADMIN_EMAIL })
  if (!user) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12)
    user = await User.create({
      email: ADMIN_EMAIL,
      passwordHash: hash,
      displayName: 'SPV School Admin',
      businessId: business._id,
      resellerId: reseller._id,
      role: 'client',
      isActive: true,
    })
    console.log(`✅ Created dashboard user: ${ADMIN_EMAIL}`)
  } else {
    await User.updateOne(
      { _id: user._id },
      {
        $set: {
          businessId: business._id,
          resellerId: reseller._id,
          displayName: user.displayName || 'SPV School Admin',
          isActive: true,
        },
      }
    )
    console.log(`ℹ️  Dashboard user already exists — updated: ${ADMIN_EMAIL}`)
  }

  mongoose.disconnect()
  console.log('Setup complete.')
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
