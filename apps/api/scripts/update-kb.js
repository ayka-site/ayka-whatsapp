/**
 * KB Update Script — Cross-references PDF data against current MongoDB KB
 * Does targeted $set — never overwrites the entire document
 * Logs exactly what changed
 */
require('dotenv').config()
const mongoose = require('mongoose')
const { KnowledgeBase } = require('@ayka/db')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB\n')

  const businessId = process.argv[2] || process.env.BUSINESS_ID
  const filter = businessId ? { businessId } : {}
  const kb = await KnowledgeBase.findOne(filter)
  if (!kb) { console.error('No KB found!' + (businessId ? ` (businessId: ${businessId})` : ' Pass businessId as argument or set BUSINESS_ID env var')); process.exit(1) }

  console.log(`Found KB: ${kb._id} (business: ${kb.businessId})\n`)

  // ═══════════════════════════════════════════════════════════════════
  // Build the $set object — only fields that are missing or incorrect
  // ═══════════════════════════════════════════════════════════════════
  const updates = {}
  const changes = []

  // ── about section corrections ──
  // Address: missing "Lucknow Road NH-28C" — confirmed from user + PDFs
  const currentAddr = kb.content?.about?.address || ''
  if (!currentAddr.includes('Lucknow Road')) {
    updates['content.about.address'] = 'Pashupati Nagar, Lucknow Road NH-28C, Bahraich, Uttar Pradesh – 271902'
    changes.push(`about.address: Added "Lucknow Road NH-28C" — was "${currentAddr}"`)
  }

  // Founder — missing entirely
  if (!kb.content?.about?.founder) {
    updates['content.about.founder'] = 'Sant Pathik Ji Maharaj'
    changes.push('about.founder: ADDED "Sant Pathik Ji Maharaj" (from DOC & Intro PDFs)')
  }

  // Manager — missing entirely
  if (!kb.content?.about?.manager) {
    updates['content.about.manager'] = 'Shri Awadhesh Narayan Agarwal'
    changes.push('about.manager: ADDED "Shri Awadhesh Narayan Agarwal" (from MD & Principal PDF)')
  }

  // Vision — missing
  if (!kb.content?.about?.vision) {
    updates['content.about.vision'] = 'Education with Values and Excellence'
    changes.push('about.vision: ADDED (from MD desk message)')
  }

  // Mission — missing
  if (!kb.content?.about?.mission) {
    updates['content.about.mission'] = 'To create an environment where children learn modern education along with Indian cultural values'
    changes.push('about.mission: ADDED (from MD desk message)')
  }

  // Campus in acres — more parent-friendly than sq mtr
  if (!kb.content?.about?.campusAcres) {
    updates['content.about.campusAcres'] = '10 acres'
    changes.push('about.campusAcres: ADDED "10 acres" (from Intro PDF — more parent-friendly)')
  }

  // Medium — user confirmed "English medium"
  if (kb.content?.about?.medium !== 'English') {
    updates['content.about.medium'] = 'English'
    changes.push(`about.medium: UPDATED to "English" — was "${kb.content?.about?.medium}" (user confirmed CBSE English medium)`)
  }

  // Description — update for accuracy (nearly 4 decades, not 35 years)
  updates['content.about.description'] = 'Sant Pathik Vidyalaya is a CBSE-affiliated English medium co-educational Senior Secondary school in Bahraich, UP. Established in 1987, the school has nearly four decades of academic excellence. Spread across 10 acres with 75 classrooms, 8 labs, smart board classrooms, STEM & Robotics lab, Sports Mini Stadium, hostel facility, and school transport. The school combines modern education with Indian cultural values.'
  changes.push('about.description: UPDATED — modernized with new facilities and accurate timeline')

  // ── principal message — update from PDF ──
  updates['content.principal.message'] = 'Our vidyalaya imparts value and skill based education bringing out the best in every child. Our earnest effort is to provide a conducive learning environment so that when students go out, they brim with confidence. The essence of Sant Pathik Vidyalaya lies in its inclusiveness.'
  changes.push('principal.message: UPDATED from Principal\'s desk message in PDF')

  // ── infrastructure — new facilities from PDFs ──
  if (!kb.content?.infrastructure?.smartBoards) {
    updates['content.infrastructure.smartBoards'] = 'Digital classrooms with smart boards'
    changes.push('infrastructure.smartBoards: ADDED (from Intro & Achievements PDFs)')
  }

  if (!kb.content?.infrastructure?.sportsStadium) {
    updates['content.infrastructure.sportsStadium'] = 'Sports Mini Stadium with all synthetic playgrounds (largest in Devipatan mandal)'
    changes.push('infrastructure.sportsStadium: ADDED (from Intro PDF)')
  }

  if (!kb.content?.infrastructure?.stemLab) {
    updates['content.infrastructure.stemLab'] = 'STEM & Junior Tinkering Laboratory'
    changes.push('infrastructure.stemLab: ADDED (from Subjects PDF)')
  }

  if (!kb.content?.infrastructure?.library) {
    updates['content.infrastructure.library'] = 'Well-stocked library'
    changes.push('infrastructure.library: ADDED (from Alumni PDF)')
  }

  // ── transport — was empty, now from PDFs ──
  if (!kb.content?.transport) {
    updates['content.transport'] = {
      summary: 'School transport available for all students covering Bahraich city and surrounding areas',
      incharge: 'Mr. Ravikant Srivastava'
    }
    changes.push('transport: ADDED section (from Intro & Office Staff PDFs)')
  }

  // ── hostel — new section from PDFs ──
  if (!kb.content?.hostel) {
    updates['content.hostel'] = {
      available: true,
      summary: 'Boarding facility with affordable shared dormitories, clean and hygienic mess, 24×7 security, visiting doctor, yoga, sports activities, organized educational tours and excursions'
    }
    changes.push('hostel: ADDED section (from Intro PDF)')
  }

  // ── highlights — richer achievements from PDFs ──
  updates['content.highlights'] = [
    '99.48% Class 10 result (2024) — Excellent Performance by CBSE',
    '95.21% Class 12 result (2024) — Excellent Performance by CBSE',
    'Student Aarav Raghuvanshi (Class V) won ₹3,20,000 on Kaun Banega Crorepati — national recognition',
    'Vaishnavi Singh (Class XI) honored at national level by Central Vigilance Commission for essay competition',
    'Runner-up at CBSE Cluster Level in Kabaddi (U-17)',
    '75% Gold medals in District Inter-School Sports Competition (NAPS)',
    '1st position in Kabaddi, Chess, Volleyball, Shot Put, and Athletics (100m, 200m, 400m, 800m, Long Jump) at district level',
    'Sports Mini Stadium with synthetic playgrounds — largest in Devipatan mandal',
    'STEM & Robotics Lab and Smart Board digital classrooms',
    'Nearly four decades of educational excellence since 1987',
    'Hostel facility with 24×7 security and mess',
    'Notable alumni in civil services (PCS), medicine (RML Hospital, KGMU), IIT BHU, SAIL, and USA'
  ]
  changes.push('highlights: UPDATED — expanded from 0 to 12 items from Achievement & Intro PDFs')

  // ── subjects — new section from Subject PDF ──
  if (!kb.content?.subjects) {
    updates['content.subjects'] = {
      seniorSecondary: {
        science: 'English Core, Hindi Core, Physics, Chemistry, Biology/Mathematics, Computer Science/Physical Education',
        commerce: 'English Core, Hindi Core, Accountancy, Business Studies, Economics, Computer Science/Physical Education',
        humanities: 'English Core, Hindi Core, History, Political Science, Economics, Computer Science/Physical Education'
      },
      secondary: 'English, Hindi, Mathematics (Standard/Basic), Science, Social Science, Information Technology',
      middle: 'English, Hindi, Mathematics, Science, Social Science, Sanskrit, Computer Education, GK, Art & Craft, Music, Physical Education',
      primary: 'English, Hindi, Mathematics, EVS, Social Science, Computer Education, GK, Art & Craft, Music, Physical Education',
      prePrimary: 'Hindi, English, Numbers & Shapes, Art & Craft, Music & Dance, Social Skills, Ethics, Games (NEP-2020 aligned)'
    }
    changes.push('subjects: ADDED complete section (from Subject PDF — all levels)')
  }

  // ── core values — from Values/Achievements PDFs ──
  if (!kb.content?.coreValues) {
    updates['content.coreValues'] = 'Integrity, Respect, Discipline, Team Work, and Excellence'
    changes.push('coreValues: ADDED (from Achievements & Values PDFs)')
  }

  // ── exam schedule — from Test PDF ──
  if (!kb.content?.examSchedule) {
    updates['content.examSchedule'] = 'Periodic Tests in May, August, November. Term Exams in September and February-March. Pre-Board Exams (Class X & XII) in December and January. Board Exams in February-March.'
    changes.push('examSchedule: ADDED (from Test PDF)')
  }

  // ── alumni — from Alumni PDF ──
  if (!kb.content?.alumni) {
    updates['content.alumni'] = [
      { name: 'Kirti Vardhan Singh', role: 'PCS, Labour Enforcement Officer', yearPassOut: 2009 },
      { name: 'Dr. Shivansh Vishwakarma', role: 'MBBS, MD (PMR), Senior Resident, Ram Manohar Lohia Hospital, Lucknow', yearPassOut: 2010 },
      { name: 'Dr. Anupam Awasthi', role: 'MBBS, MS (OBS & GYN)', yearPassOut: 2008 },
      { name: 'Dr. Pratul Agarwal', role: 'MBBS, Medical Officer, Indian Railway NER', yearPassOut: 2013 },
      { name: 'Kumar Saurabh', role: 'Senior Manager (Research & Control), SAIL', yearPassOut: 2001 },
      { name: 'Shrami Agarwal', role: 'IIT BHU (Student)', yearPassOut: 2022 },
      { name: 'Dr. Kirti Matanhelia', role: 'MBBS, KMC Manipal, OBGY, Narayana Hrudayalaya Bangalore', yearPassOut: 2016 },
      { name: 'Dr. Apurv Pandey', role: 'Resident Doctor, KGMU Lucknow', yearPassOut: null },
      { name: 'Kushal Agarwal', role: 'Senior Software Engineer, Washington DC, USA', yearPassOut: 2005 },
      { name: 'Dr. Kaushal Kumar Nigam', role: 'Assistant Professor Grade-I', yearPassOut: 1999 }
    ]
    changes.push('alumni: ADDED 10 notable alumni (from Alumni PDF)')
  }

  // ── admissions status — update to current session ──
  if (kb.content?.admissions?.status?.includes('2025-26')) {
    updates['content.admissions.status'] = 'Open for 2026-27 session'
    changes.push('admissions.status: UPDATED from "2025-26" to "2026-27"')
  }

  // ── activities — summary from Activities PDF ──
  if (!kb.content?.activities) {
    updates['content.activities'] = 'Year-round curricular and co-curricular activities including sports tournaments, quiz competitions, essay writing, art competitions, cultural celebrations, National days, and inter-school competitions. Monthly events for all sections from Pre-Primary to Senior Secondary.'
    changes.push('activities: ADDED summary (from Activities PDF)')
  }

  // ═══════════════════════════════════════════════════════════════════
  // Apply the update
  // ═══════════════════════════════════════════════════════════════════
  console.log('═══ CHANGES TO APPLY ═══')
  changes.forEach((c, i) => console.log(`  ${i + 1}. ${c}`))
  console.log(`\nTotal fields: ${changes.length}\n`)

  const result = await KnowledgeBase.updateOne(
    { _id: kb._id },
    { $set: updates }
  )

  console.log(`MongoDB result: matchedCount=${result.matchedCount}, modifiedCount=${result.modifiedCount}`)

  // Verify
  const updated = await KnowledgeBase.findById(kb._id).lean()
  console.log('\n═══ VERIFICATION ═══')
  console.log(`  address: ${updated.content.about.address}`)
  console.log(`  founder: ${updated.content.about.founder}`)
  console.log(`  vision: ${updated.content.about.vision}`)
  console.log(`  medium: ${updated.content.about.medium}`)
  console.log(`  campus: ${updated.content.about.campusAcres}`)
  console.log(`  smartBoards: ${updated.content.infrastructure.smartBoards}`)
  console.log(`  sportsStadium: ${updated.content.infrastructure.sportsStadium}`)
  console.log(`  stemLab: ${updated.content.infrastructure.stemLab}`)
  console.log(`  transport: ${updated.content.transport?.summary}`)
  console.log(`  hostel: ${updated.content.hostel?.summary?.substring(0, 60)}...`)
  console.log(`  highlights: ${updated.content.highlights?.length} items`)
  console.log(`  subjects: ${Object.keys(updated.content.subjects || {}).length} levels`)
  console.log(`  alumni: ${updated.content.alumni?.length} records`)
  console.log(`  admissions: ${updated.content.admissions?.status}`)
  console.log(`  coreValues: ${updated.content.coreValues}`)
  console.log(`  examSchedule: ${updated.content.examSchedule?.substring(0, 60)}...`)
  console.log(`  activities: ${updated.content.activities?.substring(0, 60)}...`)

  await mongoose.disconnect()
  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
