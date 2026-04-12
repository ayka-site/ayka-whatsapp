#!/usr/bin/env node
/**
 * seed-iap.js - Onboard IAP Professional (Coaching vertical)
 *
 * Creates:
 *   1. IAP Professional Business document
 *   2. Knowledge Base with all courses, fees, FAQ, and policies
 *   3. Dashboard user: admin@iapprofessional.in (role: client)
 *
 * Run (dev/local):
 *   node scripts/seed-iap.js
 *
 * Run (production Atlas):
 *   MONGODB_URI="$(grep MONGODB_URI .env.production | cut -d= -f2-)" node scripts/seed-iap.js
 *
 * WhatsApp credentials (set via env when ready):
 *   WA_PHONE_NUMBER_ID=<real-id>
 *   WA_ACCESS_TOKEN=<real-token>
 *   WA_WABA_ID=<real-waba-id>
 *   WA_VERIFY_TOKEN=<your-verify-token>
 */
require('dotenv').config()
const mongoose = require('mongoose')
const bcrypt   = require('bcryptjs')
const crypto   = require('crypto')
const { Business, KnowledgeBase, User, Reseller } = require('@ayka/db')

const ADMIN_EMAIL    = process.env.IAP_ADMIN_EMAIL    || 'admin@iapprofessional.in'
const ADMIN_PASSWORD = process.env.IAP_ADMIN_PASSWORD || crypto.randomBytes(12).toString('base64url')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB\n')

  // ── 1. Resolve reseller (WellTechUp) ──
  const reseller = await Reseller.findOne({ slug: 'welltechup' })
  if (!reseller) {
    console.error('WellTechUp reseller not found. Run seed-dashboard.js first.')
    process.exit(1)
  }
  console.log(`Reseller: ${reseller.name} (${reseller._id})`)

  // ── 2. Create or update Business ──
  let business = await Business.findOne({ slug: 'iap-professional' })
  const waPhoneNumberId = process.env.WA_PHONE_NUMBER_ID || 'PLACEHOLDER_IAP_WA'
  const waAccessToken   = process.env.WA_ACCESS_TOKEN    || 'placeholder_access_token'
  const waWabaId        = process.env.WA_WABA_ID         || 'placeholder_waba_id'
  const waVerifyToken   = process.env.WA_VERIFY_TOKEN    || 'iap_webhook_secret_2026'

  if (!business) {
    business = await Business.create({
      resellerId: reseller._id,
      name:       'IAP Professional',
      slug:       'iap-professional',
      vertical:   'coaching',
      whatsapp: {
        phoneNumberId: waPhoneNumberId,
        accessToken:   waAccessToken,
        wabaId:        waWabaId,
        verifyToken:   waVerifyToken,
      },
      settings: {
        displayName:  'IAP Professional',
        agentName:    'Riya',
        timezone:     'Asia/Kolkata',
        language:     'hi',
        handoffPhone: '+919625600057',
      },
      subscription: { plan: 'pro', status: 'active' },
      isActive: true,
    })
    console.log(`✅ Created Business: ${business.name} (${business._id})`)
  } else {
    // Update WhatsApp credentials if real ones are provided
    const update = {
      'settings.agentName':    'Riya',
      'settings.handoffPhone': '+919625600057',
      resellerId: reseller._id,
    }
    if (process.env.WA_PHONE_NUMBER_ID) update['whatsapp.phoneNumberId'] = waPhoneNumberId
    if (process.env.WA_ACCESS_TOKEN)    update['whatsapp.accessToken']   = waAccessToken
    if (process.env.WA_WABA_ID)         update['whatsapp.wabaId']        = waWabaId
    if (process.env.WA_VERIFY_TOKEN)    update['whatsapp.verifyToken']   = waVerifyToken
    await Business.updateOne({ _id: business._id }, { $set: update })
    console.log(`ℹ️  Business already exists - updated: ${business.name} (${business._id})`)
  }

  // ── 3. Knowledge Base ──
  const kbContent = {
    // Institute identity
    about: {
      name:    'IAP Professional',
      address: '43, 1st Floor, GTB Nagar, Delhi – 110009 (above Singh Motor and Finance)',
      phone:   '9625600057',
      website: 'iprofessional.in',
    },

    // Staff / contact
    staff: {
      phone:        '9625600057',
      workingHours: '9:00 AM – 7:00 PM, Monday to Saturday',
      directorName: 'Vinay Sir',
      directorPhone: '9625600057',
    },

    // Operating hours
    timing: {
      schoolHours: '9:00 AM – 7:00 PM, Monday to Saturday',
    },

    // Teaching modes
    teachingModes: ['Online', 'Offline', 'Hybrid'],

    // Courses
    courses: [
      {
        name:           'AI Application Course',
        targetAudience: 'Students, job seekers, working professionals who want to use AI tools for study, office work, and content creation.',
        toolsCovered:   ['ChatGPT', 'Microsoft Copilot', 'Filmora (AI video editing)', 'AI note-taking tools', 'Meta AI'],
        outcomes: [
          'Better writing, email drafting, and presentation prep',
          'Faster project and resume creation',
          'AI-assisted study and exam preparation',
          'Basic video editing and reels creation with AI',
          'Social media content and caption creation using AI',
        ],
        highlights: [
          'Live practical training',
          'Certificate of completion',
          'Easy-language teaching style',
          'Job & business use cases',
          'Latest AI tools training',
        ],
        modes:    'Online, Offline, Hybrid',
        duration: '3 to 15 months (Basic / Intermediate / Final/Advanced)',
        fees:     '₹7,500 – ₹1,20,000 (confirmed during counselling)',
      },
      {
        name:           'AI Smart Marketer Course',
        targetAudience: 'Students and professionals who want to learn digital marketing using AI.',
        modules: [
          'SEO for Facebook, Instagram, LinkedIn, YouTube (posts, reels, content strategy, scheduling, hashtag research, audience targeting)',
          'WordPress website development (domain & hosting, installation, themes/plugins, design with AI tools, SEO-friendly structure, blog/business site creation)',
        ],
        highlights: [
          'AI tools training (ChatGPT, Canva, automation tools)',
          'Live projects',
          'Certificate of completion',
          'Placement assistance',
          'Freelancing & business guidance',
        ],
        modes:    'Online, Offline, Hybrid',
        duration: '3 to 15 months (Basic / Intermediate / Final/Advanced)',
        fees:     '₹7,500 – ₹1,20,000 (confirmed during counselling)',
      },
      {
        name:           'AI Smart Coder Course',
        targetAudience: 'School/college students and beginners who want to learn Python programming for AI and data analysis.',
        eligibility:    '10th–12th students, college students, IT & non-IT learners.',
        modules: [
          'Introduction to AI & programming (what is AI, applications, installing Anaconda, Jupyter basics)',
          'Python fundamentals (syntax, variables, data types, input/output, conditions, loops, functions, error handling)',
          'Data visualization with Seaborn (bar, line, pie, histogram, heatmap, scatter plots)',
          'AI concepts with Python (intro to ML, supervised vs unsupervised, linear regression, classification, basic prediction models)',
          'Platform & tools (Anaconda, Jupyter, packages with pip/conda, environment setup)',
          'Practical projects (student result analyzer, sales data visualization, basic prediction model, mini AI app, project on real dataset)',
        ],
        highlights: [
          'Live practical training',
          'Certificate of completion',
          'Anaconda & Jupyter-based setup',
          'Real-world projects',
          'Job & data analysis use cases',
        ],
        modes:    'Online, Offline, Hybrid',
        duration: '3 to 15 months (Basic / Intermediate / Final/Advanced)',
        fees:     '₹7,500 – ₹1,20,000 (confirmed during counselling)',
      },
    ],

    // Fee info
    fees: {
      range:        '₹7,500 – ₹1,20,000 depending on course, level, and duration',
      paymentModes: 'Cash, UPI, Bank Transfer',
      upiId:        '7503550289@ybl',
      bankDetails:  'Axis Bank | A/C: 9130 1002 3713 398 | IFSC: UTIB0000894',
      refundPolicy: 'Fees are non-refundable once paid.',
      importantDates: '10th, 15th, 25th of every month (fee reminder dates)',
    },

    // Admission policy
    admission: {
      minAge:        '16 years',
      demoPolicy:    'First class is completely FREE. Walk-in directly to the institute on any Monday - no pre-booking required.',
      batchStartDay: 'Monday (new batch every Monday)',
      batchSize:     '15–25 students per batch',
      documentsRequired: [
        '2 passport-size photos',
        'Aadhar card',
        '10th or 12th mark sheet/certificate',
      ],
      entranceExam:  false,
      scholarshipExam: 'Institute conducts separate scholarship exams (details shared by staff on request).',
      enrollmentNumber: 'Given at registration.',
      admissionNumber:  'Issued after fee payment and final admission.',
    },

    // Differentiators
    differentiators: [
      'Faculty with more than 25 years of industry experience',
      '100% job placement assistance after course completion',
      'Personality development and soft-skills training included',
      'Backup classes available if a class is missed',
      'Focus on live practical training and real-world projects, not just theory',
      'Certificate of completion for all major courses',
      'Latest AI tools and practical use cases for jobs and business',
    ],

    // Escalation
    escalation: {
      directorName:  'Vinay Sir',
      directorPhone: '+919625600057',
      triggers: [
        'Fee negotiation or discount request',
        'Complaint about classes, faculty, or management',
        'Any question the bot cannot answer confidently',
      ],
      message: "Yeh query ke liye main aapko hamare director Vinay Sir se connect kar raha/rahi hoon, woh aapki poori madad karenge.",
    },

    // Lead capture rules
    leadCapture: {
      fields: ['fullName', 'phone', 'courseInterest', 'qualificationOrClass'],
      notifyPhone: '+919625600057',
    },

    // General FAQ (bilingual Q&A for bot)
    generalFAQ: [
      {
        q: 'Fees kitni hai? / What are the fees?',
        a: 'Fees course aur level ke hisaab se ₹7,500 se ₹1,20,000 tak hoti hai. Aap kaunsa course dekhna chahte hain – AI Application, AI Smart Marketer, ya AI Smart Coder? Main exact details bhejta/bhejti hoon.',
      },
      {
        q: 'Demo class available hai? / Is a demo class available?',
        a: 'Haan, pehli class bilkul FREE hai. Aap seedha 43, 1st Floor, GTB Nagar, IAP Professional pe aa sakte hain. Koi booking ki zaroorat nahi - kisi bhi Monday ko aa jayein.',
      },
      {
        q: 'Course kitne time ka hai? / How long is the course?',
        a: 'Courses 3 se 15 mahine tak hote hain, aapke level ke hisaab se – Basic, Intermediate, aur Final/Advanced. Counselling mein aapke goals dekhkar exact duration bataya jaega.',
      },
      {
        q: 'Placement milti hai kya? / Is placement assistance available?',
        a: 'Haan, hum 100% job placement assistance dete hain. Course ke baad resume, interview preparation aur job opportunities mein proper support milta hai.',
      },
      {
        q: 'Batch kab start hoti hai? / When do new batches start?',
        a: 'Har Monday nayi batch start hoti hai. Aap jo Monday prefer karein, uske liye admission le sakte hain.',
      },
      {
        q: 'Study material milega? / Is study material provided?',
        a: 'Classes mein practical notes, recordings ya digital resources diye jaate hain, aur agar koi class miss ho jaaye toh backup class milti hai.',
      },
      {
        q: 'Kaunse documents chahiye admission ke liye? / What documents are needed for admission?',
        a: '2 passport size photos, Aadhar card, aur 10th ya 12th ki mark sheet/certificate. Ye documents admission ke waqt le aaiye.',
      },
      {
        q: 'Online classes hain? / Are online classes available?',
        a: 'Haan, Online, Offline aur Hybrid – teeno options available hain. Aap apne hisaab se mode select kar sakte hain.',
      },
      {
        q: 'Age limit kya hai? / What is the minimum age?',
        a: 'Minimum age 16 years hai. Isse upar koi bhi student ya working professional join kar sakta/sakti hai.',
      },
      {
        q: 'Certificate milta hai? / Is a certificate provided?',
        a: 'Haan, course successfully complete karne ke baad IAP Professional ka certificate of completion diya jaata hai.',
      },
      {
        q: 'Extra benefits kya milenge? / What are the extra benefits?',
        a: 'Aapko live practical training, easy-language teaching, latest AI tools ka hands-on use, job & business use cases, aur placement/freelancing guidance milti hai – course ke hisaab se.',
      },
      {
        q: 'AI Application Course mein kya sikhate hain? / What is covered in the AI Application Course?',
        a: 'Is course mein ChatGPT, Microsoft Copilot, Filmora (AI video editing), AI note-taking tools aur Meta AI sikhaye jaate hain. Writing, emails, presentations, resume, study, reels, aur social media content ke liye AI ka practical use.',
      },
      {
        q: 'AI Smart Marketer Course mein kya sikhate hain? / What is in the AI Smart Marketer Course?',
        a: 'Is course mein Facebook, Instagram, LinkedIn, YouTube SEO aur content strategy ke saath WordPress website development sikhaya jaata hai. AI tools jaise ChatGPT aur Canva se live projects karte hain. Placement aur freelancing guidance bhi milti hai.',
      },
      {
        q: 'AI Smart Coder Course ke liye kya eligibility hai? / Who can join the AI Smart Coder Course?',
        a: '10th–12th ke students, college students, aur IT ya non-IT background waale koi bhi join kar sakte hain. Minimum age 16 years hai. Python programming aur AI/data analysis sikhate hain.',
      },
      {
        q: 'Payment kaise kare? / How to make payment?',
        a: 'Cash, UPI (7503550289@ybl), ya bank transfer (Axis Bank | A/C: 9130 1002 3713 398 | IFSC: UTIB0000894) se payment kar sakte hain.',
      },
      {
        q: 'Refund milega? / Is refund available?',
        a: 'Fees non-refundable hoti hai ek baar payment ho jaane ke baad. Koi bhi doubt pehle counselling mein clear kar sakte hain.',
      },
      {
        q: 'Address kya hai? / Where is the institute located?',
        a: 'IAP Professional: 43, 1st Floor, GTB Nagar, Delhi – 110009. Singh Motor aur Finance ke upar. WhatsApp/call: 9625600057.',
      },
      {
        q: 'Institute ka samay kya hai? / What are the operating hours?',
        a: 'Institute 9:00 AM se 7:00 PM tak open rehta hai, Monday se Saturday.',
      },
    ],
  }

  let kb = await KnowledgeBase.findOne({ businessId: business._id })
  if (!kb) {
    kb = await KnowledgeBase.create({
      businessId: business._id,
      resellerId: reseller._id,
      vertical:   'coaching',
      content:    kbContent,
      version:    1,
      isActive:   true,
    })
    console.log(`✅ Created KnowledgeBase: ${kb._id}`)
  } else {
    await KnowledgeBase.updateOne({ _id: kb._id }, { $set: { content: kbContent, version: kb.version + 1 } })
    console.log(`ℹ️  Updated existing KnowledgeBase: ${kb._id} (version ${kb.version + 1})`)
  }

  // ── 4. Dashboard user ──
  const existingUser = await User.findOne({ email: ADMIN_EMAIL })
  if (!existingUser) {
    const hash = await bcrypt.hash(ADMIN_PASSWORD, 12)
    await User.create({
      email:        ADMIN_EMAIL,
      passwordHash: hash,
      role:         'client',
      displayName:  'IAP Professional Admin',
      businessId:   business._id,
      resellerId:   reseller._id,
      themeConfig: {
        brandName:        'IAP Professional',
        logoUrl:          null,
        primaryColor:     '#6366f1',
        accentColor:      '#818cf8',
        backgroundColor:  '#f0f0ff',
        sidebarColor:     '#ffffff',
        textColor:        '#0f172a',
        faviconUrl:       null,
        supportEmail:     'admin@iapprofessional.in',
        supportPhone:     '+919625600057',
        showPlatformCredit: false,
        features: {
          showAppointments:        false,
          showAnalytics:           true,
          showExport:              true,
          showLeadScore:           true,
          showConversations:       true,
          showActivityFeed:        true,
          showStaffNotifications:  true,
          showBotStatus:           true,
        },
      },
    })
    console.log(`✅ Created user: ${ADMIN_EMAIL}`)
  } else {
    console.log(`ℹ️  User ${ADMIN_EMAIL} already exists - skipping.`)
  }

  console.log('\n════════════════════════════════════════════════════════')
  console.log('  IAP PROFESSIONAL - ONBOARDING COMPLETE')
  console.log('════════════════════════════════════════════════════════')
  console.log(`  Business ID:     ${business._id}`)
  console.log(`  KB ID:           ${kb._id}`)
  console.log(`  Dashboard login: ${ADMIN_EMAIL} / ${ADMIN_PASSWORD}`)
  console.log(`  Vertical:        coaching`)
  console.log(`  Agent persona:   Riya`)
  console.log(`  WhatsApp ID:     ${waPhoneNumberId}`)
  console.log()
  console.log('  ⚠  WhatsApp credentials are placeholders. Once you have the')
  console.log('     real Meta WhatsApp Business API credentials, re-run with:')
  console.log()
  console.log(`     WA_PHONE_NUMBER_ID=<id> WA_ACCESS_TOKEN=<token> \\`)
  console.log(`     WA_WABA_ID=<id> WA_VERIFY_TOKEN=<token> node scripts/seed-iap.js`)
  console.log('════════════════════════════════════════════════════════\n')

  await mongoose.disconnect()
  console.log('Done.')
}

main().catch(err => {
  console.error('Seed failed:', err)
  process.exit(1)
})
