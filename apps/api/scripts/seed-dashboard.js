#!/usr/bin/env node
/**
 * seed-dashboard.js - Creates Users, Reseller, and theme configs for the dashboard.
 *
 * Run: node scripts/seed-dashboard.js
 *
 * Creates:
 *   1. WellTechUp reseller document
 *   2. superadmin@ayka.in - role: superadmin
 *   3. admin@welltechup.com - role: reseller (WellTechUp)
 *   4. admin@santpathik.in - role: client (tied to SPV business)
 */
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const crypto = require('crypto')
const { User, Reseller, Business } = require('@ayka/db')

const MONGO_URI = process.env.MONGODB_URI
const SEED_SUPERADMIN_PASSWORD = process.env.SEED_SUPERADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url')
const SEED_RESELLER_PASSWORD = process.env.SEED_RESELLER_PASSWORD || crypto.randomBytes(12).toString('base64url')
const SEED_CLIENT_PASSWORD = process.env.SEED_CLIENT_PASSWORD || crypto.randomBytes(12).toString('base64url')

async function seed() {
  await mongoose.connect(MONGO_URI)
  console.log('Connected to MongoDB')

  // ── 1. Find or create WellTechUp reseller ──
  let reseller = await Reseller.findOne({ slug: 'welltechup' })
  if (!reseller) {
    reseller = await Reseller.create({
      name: 'WellTechUp',
      slug: 'welltechup',
      email: 'admin@welltechup.com',
      phone: '+919876543210',
      plan: { name: 'pro', botSlots: 10, pricePerBot: 2999 },
      platformFeeStatus: 'paid',
      themeConfig: {
        brandName: 'WellTechUp',
        logoUrl: null,
        primaryColor: '#0ea5e9',
        accentColor: '#38bdf8',
        backgroundColor: '#f0f9ff',
        sidebarColor: '#ffffff',
        textColor: '#0f172a',
        faviconUrl: null,
        supportEmail: 'support@welltechup.com',
        supportPhone: '+919876543210',
        showPlatformCredit: true,
        features: {
          showAppointments: true,
          showAnalytics: true,
          showExport: true,
          showLeadScore: true,
          showConversations: true,
          showActivityFeed: true,
          showStaffNotifications: true,
          showBotStatus: true,
        },
      },
      isActive: true,
    })
    console.log('✅ Created WellTechUp reseller:', reseller._id)
  } else {
    console.log('ℹ️  WellTechUp reseller already exists:', reseller._id)
  }

  // ── 2. Find Sant Pathik Vidyalaya business ──
  let spvBusiness = await Business.findOne({
    $or: [
      { slug: 'sant-pathik-vidyalaya' },
      { name: { $regex: /sant.*pathik/i } },
    ]
  })
  if (!spvBusiness) {
    // Try finding any business under this reseller
    spvBusiness = await Business.findOne({ resellerId: reseller._id })
  }
  if (!spvBusiness) {
    console.log('⚠️  No SPV business found. Creating a placeholder...')
    const spvPhoneNumberId = process.env.WA_PHONE_NUMBER_ID || '1021773934354033'
    const spvWabaId = process.env.WA_WABA_ID || '918233131133295'
    const spvAccessToken = process.env.WA_ACCESS_TOKEN || 'placeholder'
    const spvVerifyToken = process.env.WA_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || 'spv_webhook_secret_2026'
    spvBusiness = await Business.create({
      resellerId: reseller._id,
      name: 'Sant Pathik Vidyalaya',
      slug: 'sant-pathik-vidyalaya',
      vertical: 'school',
      whatsapp: {
        phoneNumberId: spvPhoneNumberId,
        accessToken: spvAccessToken,
        wabaId: spvWabaId,
        verifyToken: spvVerifyToken,
      },
      settings: {
        displayName: 'Sant Pathik Vidyalaya',
        agentName: 'Priya',
        timezone: 'Asia/Kolkata',
        language: 'en',
        handoffPhone: '+919198783830',
        dashboardHandoffReplyEnabled: false,
        allowPaidReplies: false,
      },
      subscription: { plan: 'pro', status: 'active' },
      isActive: true,
    })
    console.log('✅ Created SPV business:', spvBusiness._id)
  } else {
    console.log('ℹ️  SPV business found:', spvBusiness._id, spvBusiness.name)
    // Ensure resellerId is set
    const businessSet = {
      resellerId: reseller._id,
      'settings.dashboardHandoffReplyEnabled': false,
      'settings.allowPaidReplies': false,
    }
    await Business.updateOne({ _id: spvBusiness._id }, { $set: businessSet })
    if (!spvBusiness.resellerId || spvBusiness.resellerId.toString() !== reseller._id.toString()) {
      console.log('   Updated resellerId on SPV business')
    }
    console.log('   Enforced SPV dashboard handoff reply exclusion')
  }

  // ── 3. Create users ──
  const users = [
    {
      email: 'superadmin@ayka.in',
      password: SEED_SUPERADMIN_PASSWORD,
      role: 'superadmin',
      displayName: 'AyKa Super Admin',
      businessId: null,
      resellerId: null,
      themeConfig: {
        brandName: 'AyKa',
        logoUrl: null,
        primaryColor: '#6C47FF',
        accentColor: '#a78bfa',
        backgroundColor: '#0f0f13',
        sidebarColor: '#18181f',
        textColor: '#f1f5f9',
        faviconUrl: null,
        supportEmail: 'admin@ayka.in',
        supportPhone: null,
        showPlatformCredit: false,
        features: {
          showAppointments: true,
          showAnalytics: true,
          showExport: true,
          showLeadScore: true,
          showConversations: true,
          showActivityFeed: true,
          showStaffNotifications: true,
          showBotStatus: true,
        },
      },
    },
    {
      email: 'admin@welltechup.com',
      password: SEED_RESELLER_PASSWORD,
      role: 'reseller',
      displayName: 'Harsh (WellTechUp)',
      businessId: null,
      resellerId: reseller._id,
      themeConfig: {
        brandName: 'WellTechUp',
        logoUrl: null,
        primaryColor: '#0ea5e9',
        accentColor: '#38bdf8',
        backgroundColor: '#f0f9ff',
        sidebarColor: '#ffffff',
        textColor: '#0f172a',
        faviconUrl: null,
        supportEmail: 'support@welltechup.com',
        supportPhone: '+919876543210',
        showPlatformCredit: true,
        features: {
          showAppointments: true,
          showAnalytics: true,
          showExport: true,
          showLeadScore: true,
          showConversations: true,
          showActivityFeed: true,
          showStaffNotifications: true,
          showBotStatus: true,
        },
      },
    },
    {
      email: 'admin@santpathik.in',
      password: SEED_CLIENT_PASSWORD,
      role: 'client',
      displayName: 'SPV Admin',
      businessId: spvBusiness._id,
      resellerId: reseller._id,
      themeConfig: {
        brandName: 'Sant Pathik Vidyalaya',
        logoUrl: null,
        primaryColor: '#15803d',
        accentColor: '#22c55e',
        backgroundColor: '#f0fdf4',
        sidebarColor: '#ffffff',
        textColor: '#0f172a',
        faviconUrl: null,
        supportEmail: null,
        supportPhone: null,
        showPlatformCredit: false,
        features: {
          showAppointments: true,
          showAnalytics: true,
          showExport: true,
          showLeadScore: true,
          showConversations: true,
          showActivityFeed: true,
          showStaffNotifications: false,
          showBotStatus: true,
        },
      },
    },
  ]

  for (const u of users) {
    const existing = await User.findOne({ email: u.email })
    if (existing) {
      console.log(`ℹ️  User ${u.email} already exists - updating...`)
      const hash = await bcrypt.hash(u.password, 12)
      await User.updateOne({ _id: existing._id }, {
        $set: {
          passwordHash: hash,
          role: u.role,
          displayName: u.displayName,
          businessId: u.businessId,
          resellerId: u.resellerId,
          themeConfig: u.themeConfig,
          isActive: true,
        }
      })
    } else {
      const hash = await bcrypt.hash(u.password, 12)
      await User.create({
        email: u.email,
        passwordHash: hash,
        role: u.role,
        displayName: u.displayName,
        businessId: u.businessId,
        resellerId: u.resellerId,
        themeConfig: u.themeConfig,
      })
      console.log(`✅ Created user: ${u.email}`)
    }
  }

  console.log('\n════════════════════════════════════════════')
  console.log('  DASHBOARD CREDENTIALS')
  console.log('════════════════════════════════════════════')
  console.log(`  Super Admin:  superadmin@ayka.in / ${SEED_SUPERADMIN_PASSWORD}`)
  console.log(`  Reseller:     admin@welltechup.com / ${SEED_RESELLER_PASSWORD}`)
  console.log(`  Client:       admin@santpathik.in / ${SEED_CLIENT_PASSWORD}`)
  if (!process.env.SEED_SUPERADMIN_PASSWORD || !process.env.SEED_RESELLER_PASSWORD || !process.env.SEED_CLIENT_PASSWORD) {
    console.log('  NOTE: One or more passwords were auto-generated for this run. Set SEED_* env vars for fixed credentials.')
  }
  console.log('════════════════════════════════════════════\n')

  await mongoose.disconnect()
  console.log('Done.')
}

seed().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
