#!/usr/bin/env node
/**
 * Seed Buildsworth CADD Centre / Buildsworth Academy demo tenant.
 *
 * Run from ayka/apps/api:
 *   node scripts/seed-buildsworth.js
 *
 * Optional WhatsApp env:
 *   WA_PHONE_NUMBER_ID=<facebook-test-phone-number-id>
 *   WA_ACCESS_TOKEN=<facebook-access-token>
 *   WA_WABA_ID=<waba-id>
 *   WA_VERIFY_TOKEN=<verify-token>
 */
const path = require('path')
require('dotenv').config({ path: path.resolve(__dirname, '../.env.production') })
require('dotenv').config({ path: path.resolve(__dirname, '../.env'), override: true })
require('dotenv').config()

const mongoose = require('mongoose')
const bcrypt = require('bcryptjs')
const { Business, KnowledgeBase, Reseller, User } = require('@ayka/db')
const { encrypt } = require('../src/utils/encryption')

const BUSINESS_SLUG = 'buildsworth-cadd-centre'
const ADMIN_EMAIL = process.env.BUILDSWORTH_ADMIN_EMAIL || 'admin@buildsworthgroup.com'
const ADMIN_PASSWORD = process.env.BUILDSWORTH_ADMIN_PASSWORD || 'BuildsworthDemo2026!'
const DEFAULT_PLACEHOLDER_PHONE_ID = 'PLACEHOLDER_BUILDSWORTH_WA'
const DEFAULT_WA_VERIFY_TOKEN = 'buildsworth_demo_verify_2026'

async function ensureReseller() {
  let reseller = await Reseller.findOne({ slug: 'welltechup' })
  if (reseller) return reseller

  return Reseller.create({
    name: 'WellTechUp',
    slug: 'welltechup',
    email: 'admin@welltechup.com',
    phone: '+919876543210',
    platformFeeStatus: 'paid',
    themeConfig: {
      brandName: 'WellTechUp',
      primaryColor: '#0ea5e9',
      accentColor: '#38bdf8',
      backgroundColor: '#f0f9ff',
      sidebarColor: '#ffffff',
      textColor: '#0f172a',
      showPlatformCredit: true,
    },
    isActive: true,
  })
}

function buildKnowledgeBase() {
  return {
    about: {
      name: 'Buildsworth CADD Centre and Buildsworth Academy',
      shortName: 'Buildsworth',
      description: 'Specialized technical training institute in Kerala helping aspiring civil engineers bridge the gap between academics and industry through practical, job-oriented training.',
      phones: ['+918606690010', '+919086690025', '+918086690025'],
      email: 'info.buildsworthgroup@gmail.com',
      website: 'www.artiumschoolofdesign.com',
      locations: [
        'Pandalam - Opposite Archana Hospital, MC Road',
        'Pandalam - Opposite Trilok Cinemas, MC Road',
      ],
      classModes: ['Offline', 'Online live'],
      partnerships: ['MoUs with engineering colleges for workshops and practical-oriented training sessions'],
    },
    staff: {
      phone: '+918606690010',
      workingHours: 'Contact institute for current batch timings and counselling slots.',
    },
    teachingModes: ['Offline', 'Online live'],
    departments: {
      civilEngineeringAndArchitecture: {
        shortTermOffers: [
          {
            name: 'Civil Draftman (AutoCAD)',
            duration: '25 days',
            fee: '₹6,000, payable in 2 installments',
            includes: ['Municipality/Panchayath permission drawings', 'Complete interior/exterior detail drawings', 'Experience certificate'],
          },
          {
            name: 'Architect / Interior Designer Summer Offer',
            discount: '45% discount',
            softwares: ['AutoCAD 2D & 3D', '3DS Max', 'Revit Architecture', 'VRay', 'Google SketchUp', 'Lumion'],
          },
          {
            name: 'Diploma in Interior & Exterior Design Offer',
            discount: '55% fee discount for first 25 registrations',
            freeAddOns: ['Permit drawings', 'Vastu Sastra', 'Site visits', 'Experience certificates'],
          },
        ],
        comprehensivePackages: [
          { code: 'BW-CC-001', name: 'Diploma in Interior & Exterior Design', duration: '6 Months', actualFee: '₹72,000', discountedFee: '₹39,500', placement: 'Assured Placement' },
          { code: 'BW-CC-002', name: 'Certificate in Interior & Exterior Design', duration: '3 Months', actualFee: '₹40,000', discountedFee: '₹28,500' },
          { code: 'BW-CC-003', name: 'Certified Civil Engineer', duration: '6 Months', actualFee: '₹85,000', discountedFee: '₹58,900', placement: 'Assured Placement' },
          { code: 'BW-CC-004', name: 'Civil Quantity Surveying (A)', duration: '2 Months', actualFee: '₹35,000', discountedFee: '₹24,500' },
          { code: 'BW-CC-005', name: 'Civil Quantity Surveying + Civil QA/QC (B)', duration: '3 Months', actualFee: '₹65,000', discountedFee: '₹39,500' },
          { code: 'N/A', name: 'Civil QA/QC', duration: '2 Months', actualFee: '₹25,000', discountedFee: '₹15,000' },
          { code: 'BW-CC-006', name: 'BIM (Professional BIM)', duration: '3 Months', actualFee: '₹45,000', discountedFee: '₹32,900', placement: '100% Assistance' },
        ],
        quantitySurveyingModules: [
          'Target roles: Contract Engineer, Estimation/Tendering Engineer, Billing Engineer, Cost Engineer, Procurement Engineer, Planning Engineer, Quantity Surveyor',
          'Modules 1-3: QS basics, Excel/AutoCAD basics, construction workflow, metric systems, measurement units, estimate types and methods',
          'Modules 4-6: Material estimation, measurement rules, dismantling/demolition, detailed rate analysis for concrete, labor and materials',
          'Modules 7-9: BBS, BOQ, quantity takeoff, schedule of rates, RA/final bills and vouchers',
          'Modules 10-12: Tenders/contracts, work/purchase orders, value engineering, building valuation, variations and change orders',
        ],
        softwareCourses: [
          { code: 'BW-CC-009', name: 'AutoCAD 2D & 3D', fee: '₹12,500' },
          { code: 'BW-CC-010', name: 'Revit Architecture', fee: '₹15,000' },
          { code: 'BW-CC-011', name: 'Revit Structure', fee: '₹20,000' },
          { code: 'BW-CC-012', name: 'ETABS', fee: '₹22,000' },
          { code: 'BW-CC-013', name: 'SketchUp', fee: '₹15,000' },
          { code: 'BW-CC-014', name: '3DS MAX', fee: '₹15,000' },
          { code: 'BW-CC-015', name: 'Primavera', fee: '₹20,000' },
          { code: 'BW-CC-016', name: 'STADD', fee: '₹20,000' },
          { code: 'BW-CC-017', name: 'Lumion / VRay', fee: '₹8,500' },
          { code: 'BW-CC-018', name: 'Photoshop', fee: '₹7,000' },
          { code: 'BW-CC-019', name: 'K-SMART Drawing Course', fee: '₹23,500' },
        ],
      },
      mechanicalEngineering: {
        note: 'No specific Mechanical Engineering course data is available in the current materials.',
      },
      electricalEngineering: {
        courses: [
          { name: 'Certification in Electrical Product Design', softwares: ['AutoCAD 2D & 3D', 'Revit MEP', 'Primavera'], duration: '4 Months', fee: '₹29,500' },
          { name: 'Certification in Electrical Product Design', softwares: ['AutoCAD 2D & 3D', 'Revit MEP'], duration: '3 Months', fee: '₹26,500' },
          { name: 'Certification in Electrical Estimation & Costing', softwares: ['AutoCAD 2D & 3D', 'Revit MEP', 'Primavera', 'PROCORE'], duration: '3 Months', fee: '₹38,500' },
        ],
      },
      accountingAndFinance: {
        note: 'No specific Accounting and Finance course data is available in the current materials.',
      },
    },
    highlights: [
      'Government approved certificates',
      'Associated with Autodesk, STED Council, NSDC, Skill India and MSME',
      '100+ placements',
      '100% placement assistance or guarantee depending on the course',
      'Faculty are working industry professionals with real-world experience',
      'Quantity Surveying graduates can command higher starting salaries due to specialized knowledge',
    ],
    leadCapture: {
      fields: ['fullName', 'phone', 'courseInterest', 'educationBackground', 'preferredMode'],
      notifyPhone: '+918606690010',
    },
    escalation: {
      phone: '+918606690010',
      triggers: ['discount negotiation', 'custom batch timing', 'placement guarantee clarification', 'complaint', 'question not in knowledge base'],
      message: 'For this query, I will connect you with the Buildsworth counselling team so they can guide you properly.',
    },
    generalFAQ: [
      { q: 'Where is Buildsworth located?', a: 'Buildsworth is in Pandalam, Kerala, with locations opposite Archana Hospital on MC Road and opposite Trilok Cinemas on MC Road.' },
      { q: 'Are online classes available?', a: 'Yes. Classes are available in offline and online live formats.' },
      { q: 'Do you provide certificates?', a: 'Yes. Buildsworth issues Government Approved Certificates and is associated with Autodesk, STED Council, NSDC, Skill India and MSME.' },
      { q: 'Is placement available?', a: 'Yes. Buildsworth has 100+ placements and offers placement assistance or placement guarantee depending on the course.' },
      { q: 'Which course is best for civil engineering students?', a: 'Popular options include Certified Civil Engineer, Civil Quantity Surveying, Civil QA/QC, BIM, and Interior & Exterior Design. The right course depends on whether the student wants design, site, QS, QA/QC, or BIM roles.' },
    ],
    botInstructions: [
      'Act as a helpful Buildsworth course counsellor.',
      'First identify the student’s department/course interest, background and preferred mode.',
      'Give exact fees/durations only when they are present in the knowledge base.',
      'If a department has no data, say that details are not available in the current materials and offer to connect the counselling team.',
      'For discounts, admissions and placement guarantee specifics, suggest speaking to the counselling team.',
    ],
  }
}

async function clearTenantCache(phoneNumberId) {
  if (!phoneNumberId) return
  try {
    const redis = require('../src/config/redis')
    await redis.del(`tenant:${phoneNumberId}`)
    redis._client?.disconnect?.()
  } catch (err) {
    console.warn('Could not clear Redis tenant cache:', err.message)
  }
}

async function main() {
  if (!process.env.MONGODB_URI) {
    console.error('MONGODB_URI is required')
    process.exit(1)
  }
  if (!process.env.ENCRYPTION_KEY) {
    console.error('ENCRYPTION_KEY is required to encrypt WhatsApp tokens')
    process.exit(1)
  }

  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')

  const reseller = await ensureReseller()
  const waPhoneNumberId = process.env.WA_PHONE_NUMBER_ID || DEFAULT_PLACEHOLDER_PHONE_ID
  const waAccessToken = process.env.WA_ACCESS_TOKEN || 'buildsworth_placeholder_access_token'
  const waWabaId = process.env.WA_WABA_ID || 'PLACEHOLDER_BUILDSWORTH_WABA'
  const waVerifyToken = process.env.WA_VERIFY_TOKEN || process.env.META_WEBHOOK_VERIFY_TOKEN || DEFAULT_WA_VERIFY_TOKEN
  const encryptedToken = encrypt(waAccessToken)

  const existing = await Business.findOne({
    'whatsapp.phoneNumberId': waPhoneNumberId,
    slug: { $ne: BUSINESS_SLUG },
  })
  if (existing && waPhoneNumberId !== DEFAULT_PLACEHOLDER_PHONE_ID) {
    console.error(`Phone number id ${waPhoneNumberId} is already assigned to ${existing.slug}.`)
    console.error('Use scripts/switch-demo-phone.js after seeding to move the shared test number safely.')
    process.exit(1)
  }

  const business = await Business.findOneAndUpdate(
    { slug: BUSINESS_SLUG },
    {
      $set: {
        resellerId: reseller._id,
        name: 'Buildsworth CADD Centre and Buildsworth Academy',
        slug: BUSINESS_SLUG,
        vertical: 'coaching',
        pricing: { totalPrice: 0, note: 'Education/training institute demo tenant' },
        whatsapp: {
          phoneNumberId: waPhoneNumberId,
          accessToken: encryptedToken,
          wabaId: waWabaId,
          verifyToken: waVerifyToken,
        },
        settings: {
          displayName: 'Buildsworth',
          agentName: 'Riya',
          timezone: 'Asia/Kolkata',
          language: 'en',
          handoffPhone: '+918606690010',
          dashboardHandoffReplyEnabled: true,
          allowPaidReplies: false,
        },
        widget: {
          enabled: true,
          position: 'bottom-right',
          welcomeMessage: 'Hi! I am Buildsworth’s course assistant. Which course or department are you interested in?',
          placeholder: 'Ask about courses, fees, duration, placement...',
          agentName: 'Riya',
          brandName: 'Buildsworth',
          allowedOrigins: ['http://localhost:3001'],
          collectName: true,
          collectEmail: false,
          collectPhone: true,
          poweredBy: true,
        },
        subscription: { plan: 'pro', status: 'active' },
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  await KnowledgeBase.findOneAndUpdate(
    { businessId: business._id },
    {
      $set: {
        businessId: business._id,
        vertical: 'coaching',
        content: buildKnowledgeBase(),
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  const passwordHash = await bcrypt.hash(ADMIN_PASSWORD, 10)
  await User.findOneAndUpdate(
    { email: ADMIN_EMAIL.toLowerCase() },
    {
      $set: {
        email: ADMIN_EMAIL.toLowerCase(),
        passwordHash,
        role: 'client',
        businessId: business._id,
        resellerId: reseller._id,
        displayName: 'Buildsworth Admin',
        isActive: true,
      },
    },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  )

  await clearTenantCache(waPhoneNumberId)
  await mongoose.disconnect()

  console.log('\n✅ Buildsworth tenant ready')
  console.log(`Business: ${business.name}`)
  console.log(`Slug: ${BUSINESS_SLUG}`)
  console.log(`Business ID: ${business._id}`)
  console.log(`Vertical: ${business.vertical}`)
  console.log(`WhatsApp phoneNumberId: ${waPhoneNumberId}`)
  console.log(`Dashboard user: ${ADMIN_EMAIL}`)
  console.log(`Dashboard password: ${ADMIN_PASSWORD}`)
}

main().catch((err) => {
  console.error(err)
  process.exit(1)
})
