/**
 * COMPREHENSIVE KB UPDATE — Cross-referenced against ALL 19 PDFs
 * Sources: FEE STRUCTURE 2026-27, SCHOOL DIRECTORY, Students Strength 2025-26,
 *          Faculty Details, Alumni, Activities, General Information, MD & Principal,
 *          Vidyalaya Introduction, Achievements 1-3, Test, Office Staff, Subjects,
 *          DOC (Founder's Tribute), Society Certificate/Member List
 *
 * This script does TARGETED $set — never overwrites the entire document.
 * Every change is logged with the PDF source.
 */
require('dotenv').config()
const mongoose = require('mongoose')
const { KnowledgeBase } = require('@ayka/db')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB\n')

  // ═══════════════════════════════════════════════════════════════
  // STEP 1: Read current KB
  // ═══════════════════════════════════════════════════════════════
  const businessId = process.argv[2] || process.env.BUSINESS_ID
  const filter = businessId ? { businessId } : {}
  const kb = await KnowledgeBase.findOne(filter)
  if (!kb) { console.error('No KB found!' + (businessId ? ` (businessId: ${businessId})` : ' Pass businessId as argument or set BUSINESS_ID env var')); process.exit(1) }
  console.log(`KB _id: ${kb._id}\n`)

  // ═══════════════════════════════════════════════════════════════
  // STEP 2: Build the $set payload — every field traced to PDF source
  // ═══════════════════════════════════════════════════════════════
  const updates = {}
  const changeLog = []

  function set(path, value, source) {
    updates[`content.${path}`] = value
    changeLog.push({ path, source })
  }

  // ─────────────────────────────────────────────────────────────
  // FROM: SCHOOL DIRECTORY.pdf (most authoritative — official CBSE format)
  // ─────────────────────────────────────────────────────────────

  // Pin code: KB has 271902, Directory says 271802
  set('about.address', 'Pashupati Nagar, Bahraich, Uttar Pradesh – 271802', 'SCHOOL DIRECTORY')

  // Type: KB says "Co-Educational", Directory says "Day & Boarding"
  set('about.type', 'Co-Educational Day & Boarding', 'SCHOOL DIRECTORY')

  // Level: KB says Nursery to Class 12, Directory says P.G. to XII
  set('about.level', 'Senior Secondary (Play Group to Class XII)', 'SCHOOL DIRECTORY')

  // New fields from Directory
  set('about.udiseCode', '09500707504', 'SCHOOL DIRECTORY')
  set('about.affiliationValidity', '2029', 'SCHOOL DIRECTORY')
  set('about.society', 'Sant Pathik Sevak Samiti', 'SCHOOL DIRECTORY')
  set('about.category', 'Un-Aided Private School', 'SCHOOL DIRECTORY')
  set('about.shift', 'Morning', 'SCHOOL DIRECTORY')
  set('about.curriculum', 'NCERT', 'SCHOOL DIRECTORY')
  set('about.landmark', 'Near JNV Kirtanpur', 'SCHOOL DIRECTORY')

  // Remove officePhone — not in any PDF (was "9555499715" — unverified)
  // We'll set it to the verified number from the directory
  set('about.phone', '+91-9198783830', 'SCHOOL DIRECTORY')

  // Classrooms: KB has 75, Directory says 73
  set('infrastructure.totalClassrooms', 73, 'SCHOOL DIRECTORY')

  // CCTV — new
  set('infrastructure.cctv', 'CCTV Camera with DVR/NVR', 'SCHOOL DIRECTORY')

  // Wi-Fi — new
  set('infrastructure.wifi', true, 'SCHOOL DIRECTORY')

  // Accessibility ramps — new
  set('infrastructure.rampsForCWSN', true, 'SCHOOL DIRECTORY')

  // Hostel: Directory says "Available For boys Only" — CRITICAL correction
  set('hostel.available', true, 'SCHOOL DIRECTORY')
  set('hostel.gender', 'Boys only', 'SCHOOL DIRECTORY')
  set('hostel.summary', 'Boarding facility for boys with affordable shared dormitories, clean and hygienic mess, 24×7 security, visiting doctor, yoga, sports activities, organized educational tours and excursions', 'SCHOOL DIRECTORY + VIDYALAYA INTRODUCTION')

  // Transport: add bus count and coordinator mobile
  set('transport.summary', 'School transport available for all students covering Bahraich city and surrounding areas', 'SCHOOL DIRECTORY')
  set('transport.buses', 22, 'SCHOOL DIRECTORY')
  set('transport.incharge', 'Mr. Ravikant Srivastava', 'SCHOOL DIRECTORY')
  set('transport.inchargeMobile', '7985287461', 'SCHOOL DIRECTORY')

  // Vice Principal — new
  set('vicePrincipal', {
    name: 'Mr. Bhikha Ram Tripathi',
    qualification: 'M.Sc B.Ed',
    mobile: '8318600231',
  }, 'SCHOOL DIRECTORY')

  // Primary Wing In-Charge — new
  set('primaryWingIC', {
    name: 'Mrs. Neena Chhabra',
    qualification: 'M.A. B.Ed',
    mobile: '7007884235',
  }, 'SCHOOL DIRECTORY')

  // Principal mobile & qualification — from Directory
  set('principal.qualification', 'M.A. B.Ed', 'SCHOOL DIRECTORY')
  set('principal.mobile', '8318842325', 'SCHOOL DIRECTORY')

  // Complaint Redressal Officer — new
  set('complaintRedressal', 'Vice Principal (Mr. Bhikha Ram Tripathi)', 'SCHOOL DIRECTORY')

  // Nearby locations — new (important for parents asking "school kahan hai")
  set('nearbyLocations', {
    busStand: { name: 'Bahraich Bus Stand', distance: '11 KM' },
    hospital: { name: 'PHC Fakharpur', distance: '7 KM' },
    bank: { name: 'Indian Bank, Bubkapur', distance: '1 KM' },
    policeStation: { name: 'Fakharpur Police Station', distance: '8 KM' },
    railwayStation: { name: 'Bahraich Railway Station', distance: '13 KM' },
    airport: { name: 'CCS International Airport (Lucknow)', distance: '135 KM' },
  }, 'SCHOOL DIRECTORY')

  // Nearby landmarks — important for the Bahraich audience
  set('nearbyLandmarks', [
    'Lord Ram Janmabhoomi Temple, Ayodhya (140 KM)',
    'Naimisharanya (130 KM)',
    'Buddhist Pilgrimage Site: Shravasti (50 KM)',
    'Dargah Sharif, Bahraich (12 KM)',
    'Katarniaghat Wildlife Sanctuary (110 KM)',
  ], 'SCHOOL DIRECTORY')

  // Classes — from PG not Nursery
  set('classes.from', 'Play Group (P.G.)', 'SCHOOL DIRECTORY')

  // Streams — PDFs consistently say "Humanities" not "Arts"
  set('classes.streams', ['Science', 'Commerce', 'Humanities'], 'SCHOOL DIRECTORY + SUBJECTS PDF')

  // ─────────────────────────────────────────────────────────────
  // FROM: FEE STRUCTURE 2026-27.pdf — COMPLETE OVERHAUL
  // The old KB had flat "₹1,500/month" which is WRONG for most classes
  // ─────────────────────────────────────────────────────────────
  set('fees', {
    session: '2026-27',
    note: 'Official fee structure for academic session 2026-27. Fees are FIXED — no negotiation.',
    classWise: [
      { classes: 'Play Group', tuitionPerMonth: 1600, additionalFee: 2500, annualFee: 1000 },
      { classes: 'Nursery to U.K.G', tuitionPerMonth: 1200, additionalFee: 2500, annualFee: 1000 },
      { classes: 'I to III', tuitionPerMonth: 1500, additionalFee: 2500, annualFee: 1000 },
      { classes: 'IV to V', tuitionPerMonth: 1600, additionalFee: 2500, annualFee: 1000 },
      { classes: 'VI', tuitionPerMonth: 1800, additionalFee: 3000, annualFee: 1000 },
      { classes: 'VII to VIII', tuitionPerMonth: 2000, additionalFee: 3000, annualFee: 1000 },
      { classes: 'IX & X', tuitionPerMonth: 2750, additionalFee: 5000, annualFee: 3000 },
      { classes: 'XI & XII', tuitionPerMonth: 3300, additionalFee: 7000, annualFee: 5000 },
    ],
    examFees: {
      nurseryToVIII: 1500,
      ixAndXI: 2000,
      xAndXII: 4000,
      note: 'Class X & XII exam fee includes CBSE Board fee',
    },
    paymentModes: ['Cash', 'Online Transfer'],
  }, 'FEE STRUCTURE 2026-27')

  // ─────────────────────────────────────────────────────────────
  // FROM: FACULTY DETAILS.pdf + SCHOOL DIRECTORY.pdf
  // Staff counts: KB had 62/16/17/29 → PDF says 64/14/20/30
  // ─────────────────────────────────────────────────────────────
  set('staff.totalTeachers', 64, 'FACULTY DETAILS + SCHOOL DIRECTORY')
  set('staff.pgt', 14, 'SCHOOL DIRECTORY')
  set('staff.tgt', 20, 'SCHOOL DIRECTORY')
  set('staff.prt', 30, 'SCHOOL DIRECTORY')
  set('staff.nonTeaching', 9, 'SCHOOL DIRECTORY')

  // ─────────────────────────────────────────────────────────────
  // FROM: Students Strength (2025-26).pdf
  // ─────────────────────────────────────────────────────────────
  set('students', {
    session: '2025-26',
    total: 1410,
    boys: 948,
    girls: 462,
    classWise: [
      { class: 'P.G.', boys: 6, girls: 6, total: 12 },
      { class: 'Nursery', boys: 25, girls: 41, total: 66 },
      { class: 'L.K.G', boys: 21, girls: 13, total: 34 },
      { class: 'U.K.G', boys: 27, girls: 21, total: 48 },
      { class: 'I', boys: 41, girls: 27, total: 68 },
      { class: 'II', boys: 39, girls: 22, total: 61 },
      { class: 'III', boys: 55, girls: 15, total: 70 },
      { class: 'IV', boys: 60, girls: 31, total: 91 },
      { class: 'V', boys: 57, girls: 29, total: 86 },
      { class: 'VI', boys: 64, girls: 25, total: 89 },
      { class: 'VII', boys: 71, girls: 34, total: 105 },
      { class: 'VIII', boys: 60, girls: 53, total: 113 },
      { class: 'IX', boys: 117, girls: 31, total: 148 },
      { class: 'X', boys: 94, girls: 41, total: 135 },
      { class: 'XI', boys: 95, girls: 51, total: 146 },
      { class: 'XII', boys: 100, girls: 40, total: 140 },
    ],
  }, 'Students Strength (2025-26)')

  // ─────────────────────────────────────────────────────────────
  // FROM: Alumni.pdf — add missing Dr. Sanjay Agarwal (#6)
  // + fix incomplete details for others
  // ─────────────────────────────────────────────────────────────
  set('alumni', [
    { name: 'Kirti Vardhan Singh', role: 'PCS, Labour Enforcement Officer', yearPassOut: 2009 },
    { name: 'Dr. Shivansh Vishwakarma', role: 'MBBS, MD (PMR), DNB (PMB), CCEPC, MNAMS, Senior Resident, Ram Manohar Lohia Hospital, Lucknow', yearPassOut: 2010 },
    { name: 'Dr. Anupam Awasthi', role: 'MBBS, MS (OBS & GYN)', yearPassOut: 2008 },
    { name: 'Dr. Pratul Agarwal', role: 'MBBS, Medical Officer, Indian Railway NER', yearPassOut: 2013 },
    { name: 'Kumar Saurabh', role: 'Senior Manager (Research & Control), Steel Authority of India Ltd. (SAIL)', yearPassOut: 2001 },
    { name: 'Dr. Sanjay Agarwal', role: 'MBBS, MD, Assistant Professor, Dr. Patil College, Navi Mumbai', yearPassOut: 1997 },
    { name: 'Shrami Agarwal', role: 'IIT BHU (4th Year Student)', yearPassOut: 2022 },
    { name: 'Dr. Kirti Matanhelia', role: 'MBBS, KMC Manipal, OBGY, Narayana Hrudayalaya, Bangalore', yearPassOut: 2016 },
    { name: 'Dr. Apurv Pandey', role: 'Resident Doctor, KGMU, Lucknow', yearPassOut: null },
    { name: 'Kushal Agarwal', role: 'Senior Software Engineer, Govt. Employee Insurance Company, Washington DC, USA', yearPassOut: 2005 },
    { name: 'Dr. Kaushal Kumar Nigam', role: 'Assistant Professor Grade-I', yearPassOut: 1999 },
  ], 'Alumni.pdf')

  // ─────────────────────────────────────────────────────────────
  // FROM: Activities.pdf — replace summary with structured month-by-month
  // ─────────────────────────────────────────────────────────────
  set('activities', {
    summary: 'Year-round curricular and co-curricular activities for all sections (Pre-Primary to Senior Secondary). Monthly activities, competitions, sports tournaments, quiz competitions, cultural celebrations, national days, and inter-school competitions.',
    senior: {
      section: 'VI to XII',
      monthly: [
        { month: 'April', activities: 'Earth Day Celebration, Ambedkar Jayanti', competitions: 'Art competition, Cricket Match, Patriotic Song' },
        { month: 'May', activities: 'Labour Day Celebration', competitions: 'Cricket Match, Kho-Kho, Group Song' },
        { month: 'June', activities: 'Re-opening of Vidyalaya', competitions: 'Extempore Speech' },
        { month: 'July', activities: 'Guru Poornima', competitions: 'Interview Session in English, Solo Song, Patriotic Song, GK Quiz' },
        { month: 'August', activities: 'Independence Day (15th Aug), Sadbhavana Diwas, National Sports Day', competitions: 'Extempore Speech Hindi/English, Essay Writing, Cricket Match' },
        { month: 'September', activities: "Teacher's Day (5th Sep), Hindi Pakhwara", competitions: 'Solo Song, Science Quiz' },
        { month: 'October', activities: 'Gandhi Jayanti (2nd Oct), World Mental Health Day', competitions: 'Volleyball/Kho-Kho Match, Social Science Quiz' },
        { month: 'November', activities: "Children's Day (14th Nov), Diwali Celebration", competitions: 'Art Competition (Rangoli), Inter-School Sports' },
        { month: 'December', activities: 'Christmas (25th Dec), National Maths Day, Vijay Diwas, Guru Govind Singh Jayanti', competitions: 'Instrumental, Volleyball/Kho-Kho, Maths Quiz' },
        { month: 'January', activities: 'Republic Day (26th Jan), Sant Pathik Maharaj Ji Janmoutsav, Swami Vivekanand Jayanti', competitions: 'Cricket Match' },
        { month: 'February', activities: 'CBSE Examination, National Science Day', competitions: '' },
        { month: 'March', activities: 'Board Examination, Result Declaration Ceremony', competitions: '' },
      ],
    },
    primary: {
      section: 'I to V',
      monthly: [
        { month: 'April', activities: 'Earth Day Celebration, Ambedkar Jayanti', competitions: 'Kho-Kho Match' },
        { month: 'May', activities: 'Labour Day, Investiture Ceremony', competitions: 'Hand Writing in Hindi and English' },
        { month: 'June', activities: 'Re-opening of Vidyalaya', competitions: 'Mono Acting by IV and V' },
        { month: 'July', activities: 'Guru Poornima', competitions: 'Spell Bee, Ad-Mod, Poster Making, Football, Maths Master' },
        { month: 'August', activities: 'Independence Day, Sadbhavana Diwas, Janmashtami', competitions: 'Hindi Hand Writing, Hindi Kavita' },
        { month: 'September', activities: "Teacher's Day, Hindi Pakhwara", competitions: 'Kabaddi, Reading Skill, Social Science Quiz' },
        { month: 'October', activities: 'Gandhi Jayanti, Navratri, Origami', competitions: 'Art Competition (Rangoli), Toran Making' },
        { month: 'November', activities: "Children's Day, Diwali, Interview Teaching", competitions: 'Sports, Maths Quiz' },
        { month: 'December', activities: 'Christmas, Creative Art with waste material', competitions: 'Hindi Patriotic Song, Extempore for 4-5' },
        { month: 'January', activities: 'Republic Day, Sant Pathik Maharaj Ji Janmoutsav', competitions: 'Sanskrit Shlok, Science Quiz' },
        { month: 'February', activities: 'Basant Panchami', competitions: '' },
        { month: 'March', activities: 'Board Examination, Result Declaration', competitions: '' },
      ],
    },
    prePrimary: {
      section: 'Pre-Primary (P.G. to U.K.G)',
      monthly: [
        { month: 'April', activities: 'Earth Day Celebration, Self-Introduction, Baisakhi, Green Day', competitions: 'Solo Song and Group Song' },
        { month: 'May', activities: 'Sensory Play, Yellow Day, Labour Day, Mothers Day', competitions: 'Mono Acting' },
        { month: 'July', activities: 'Story Telling, Blue Day, Good Touch/Bad Touch', competitions: 'Tear and Paste' },
        { month: 'August', activities: 'Independence Day, Janmashtami, Letters and Numbers', competitions: 'Show and Tell' },
        { month: 'September', activities: "Teacher's Day", competitions: 'Pleasure in Poetry, Pool Party' },
        { month: 'October', activities: 'Gandhi Jayanti, Navratri', competitions: 'Hand Writing (LKG/UKG)' },
        { month: 'November', activities: "Children's Day, Diwali, Orange Day", competitions: 'Spell Bee (UKG), Sensory Play' },
        { month: 'December', activities: 'Christmas, Fancy Dress', competitions: 'Hindi Kavita, English Poem' },
        { month: 'January', activities: 'Republic Day, Sant Pathik Maharaj Ji Janmoutsav', competitions: 'Story Competition' },
        { month: 'February', activities: 'Basant Panchami, Sand Pit Activity', competitions: '' },
        { month: 'March', activities: 'Exam, Result Declaration', competitions: '' },
      ],
    },
  }, 'Activities.pdf')

  // ─────────────────────────────────────────────────────────────
  // FROM: Office Staff.pdf
  // ─────────────────────────────────────────────────────────────
  set('officeStaff', [
    { name: 'Mr. Santosh Kumar Srivastava', designation: 'Office Superintendent', qualification: 'M.A., L.L.B' },
    { name: 'Mr. Jitendra Gaur', designation: 'U.D.C.', qualification: 'M.A., PGDCA, MCA' },
    { name: 'Mr. Sachin Prajapati', designation: 'L.D.C.', qualification: 'M.Com, B.Ed, CCC' },
    { name: 'Mr. Shivam Kashyap', designation: 'L.D.C.', qualification: 'Intermediate, I.T.I, CCC, BCC, Tally' },
    { name: 'Ms. Shilpa Malhotra', designation: 'Receptionist', qualification: 'M.A., M.B.A' },
    { name: 'Mr. Varun Kumar Srivastava', designation: 'Lab Assistant', qualification: 'B.Com, L.L.B' },
    { name: 'Mr. Ravikant Srivastava', designation: 'School Transportation Incharge', qualification: 'M.A.' },
  ], 'office staff.pdf')

  // ─────────────────────────────────────────────────────────────
  // FROM: General Information.pdf — School Rules
  // ─────────────────────────────────────────────────────────────
  set('schoolRules', {
    attendance: 'Minimum 80% attendance required to appear in final examination',
    ragging: 'Ragging and bullying strictly prohibited',
    tiffin: 'Every student must bring their own tiffin daily',
    uniform: 'House uniform on prescribed days',
    absentPolicy: 'Absent without information for 7 days — name struck off rolls',
    prohibitedItems: 'Mobile phone, camera, knife, electronic gadgets, smart watch, perfume, pan masala, tobacco items, alcohol — strictly prohibited',
    leavePolicy: 'No student allowed to leave during school hours without Principal permission',
    dismissal: 'Principal may dismiss student for habitual laziness, disobedience, misconduct',
  }, 'General Information.pdf')

  // ─────────────────────────────────────────────────────────────
  // FROM: DOC-20260225-WA0012..pdf — Founder's tribute
  // ─────────────────────────────────────────────────────────────
  set('founderTribute', 'Sant Pathik Ji Maharaj — a saintly soul devoted to service and enlightenment, whose sacred inspiration laid the foundation of Sant Pathik Vidyalaya in 1987. He envisioned an institution where education would not merely impart knowledge but cultivate character, discipline, and moral strength.', 'DOC (Founder Tribute)')

  // ─────────────────────────────────────────────────────────────
  // FROM: LIST OF SUBJECT OFFERED AT VARIOUS LEVELS 2026-27.pdf
  // Add middle school subjects (was missing from KB)
  // ─────────────────────────────────────────────────────────────
  set('subjects.middle', 'English, Hindi, Mathematics, Science, Social Science, Sanskrit, Computer Education, GK, Art & Craft, Music, Physical & Health Education', 'LIST OF SUBJECTS 2026-27')

  // ─────────────────────────────────────────────────────────────
  // FROM: MD & Principal.pdf — update principal message
  // ─────────────────────────────────────────────────────────────
  set('principal.name', 'Mrs. Pooja Agarwal', 'MD & Principal.pdf')
  set('principal.message', 'Our vidyalaya imparts value and skill based education bringing out the best in every child. Our earnest effort is to provide a conducive learning environment so that when they go out, they brim with confidence. The essence of Sant Pathik Vidyalaya lies in its inclusiveness. Parents involvement plays a vital role in their child\'s success.', 'MD & Principal.pdf')

  // Update manager message
  set('about.managerMessage', 'We truly believe that our education should move from knowledge to skill and wisdom, from competition to cooperation, and from division to unity. We aim to make our students capable enough to be self-directed and self-managed individuals who can confront the challenges of life.', 'MD & Principal.pdf')

  // ─────────────────────────────────────────────────────────────
  // FROM: Vidyalaya Introduction.pdf — update description
  // ─────────────────────────────────────────────────────────────
  set('about.description', 'Sant Pathik Vidyalaya is a CBSE-affiliated English medium co-educational Day and Boarding Senior Secondary school in Bahraich, UP. Established in 1987 by Sant Pathik Ji Maharaj, the school is managed by Shri Awadhesh Narayan Agarwal. Starting with 70-80 students, the school now has 1,410 students. Spread across 10 acres with 73 classrooms, 8 labs, smart board classrooms, STEM & Robotics lab, Sports Mini Stadium (largest in Devipatan Mandal), hostel facility for boys, and school transport with 22 buses.', 'VIDYALAYA INTRODUCTION + SCHOOL DIRECTORY + STUDENTS STRENGTH')

  // ─────────────────────────────────────────────────────────────
  // FROM: Achivements 1-3.pdf — update highlights to add detail
  // ─────────────────────────────────────────────────────────────
  set('highlights', [
    '99.48% Class 10 result (2024) — Excellent Performance by CBSE',
    '95.21% Class 12 result (2024) — Excellent Performance by CBSE',
    'Student Aarav Raghuvanshi (Class V) won ₹3,20,000 on Kaun Banega Crorepati — national recognition',
    'Vaishnavi Singh (Class XI) honored at national level by Central Vigilance Commission for essay competition — also received ₹11,000 from School Manager',
    'Runner-up at CBSE Cluster Level in Kabaddi (U-17); 3rd, 4th, 5th in athletics',
    '75% Gold medals in District Inter-School Sports Competition (NAPS)',
    '1st position in Kabaddi, Chess, Volleyball, Shot Put, and Athletics (100m, 200m, 400m, 800m, Long Jump) at district level',
    'Sports Mini Stadium with synthetic playgrounds — largest in Devipatan Mandal',
    'STEM & Robotics Lab and Smart Board digital classrooms',
    'Nearly four decades of educational excellence since 1987',
    'Hostel facility for boys with 24×7 security and mess',
    'Notable alumni in civil services (PCS), medicine (RML Hospital, KGMU), IIT BHU, SAIL, and USA',
    '1,410 students (2025-26) — started from 70-80 students in 1987',
    '64 qualified teachers (14 PGTs, 20 TGTs, 30 PRTs)',
    '22 buses for school transport covering Bahraich city and surrounding areas',
  ], 'Achievements 1-3 + SCHOOL DIRECTORY + STUDENTS STRENGTH')

  // Update admissions status (confirm from KB — already correct)
  set('admissions.status', 'Open for 2026-27 session', 'FEE STRUCTURE 2026-27')

  // ─────────────────────────────────────────────────────────────
  // FROM: Test.pdf — update exam schedule with more detail
  // ─────────────────────────────────────────────────────────────
  set('examSchedule', {
    summary: 'Periodic Tests in May, August, November. Term Exams in September and February-March. Pre-Board Exams (Class X & XII) in December and January. Board Exams in February-March.',
    schedule: [
      { exam: 'First Periodic Test', month: 'May' },
      { exam: 'Second Periodic Test', month: 'August' },
      { exam: 'First Term Examination', month: 'September' },
      { exam: 'Third Periodic Test', month: 'November' },
      { exam: 'First Pre-Board Examination (X & XII)', month: 'December' },
      { exam: 'Second Pre-Board Examination (X & XII)', month: 'January' },
      { exam: 'Board & Non-Board Assignment & Practicals', month: 'January' },
      { exam: 'Second Term Examination', month: 'February & March' },
      { exam: 'Board Examination (X & XII)', month: 'February & March' },
      { exam: 'Result Declaration (Home Exams)', month: 'Last week of March' },
    ],
  }, 'Test.pdf')

  // Add KNOWN_KEYS entries for new sections
  set('laboratories', {
    physics: 1,
    biology: 1,
    chemistry: 1,
    computer: 2,
    compositeScience: 1,
    mathematics: 1,
    stemAndTinkering: 1,
    total: 8,
  }, 'LIST OF SUBJECTS 2026-27')

  // ═══════════════════════════════════════════════════════════════
  // STEP 3: Apply the update
  // ═══════════════════════════════════════════════════════════════
  console.log(`Applying ${changeLog.length} field updates...\n`)

  changeLog.forEach(({ path, source }) => {
    console.log(`  ✏️  content.${path} ← [${source}]`)
  })

  const result = await KnowledgeBase.updateOne(
    { _id: kb._id },
    { $set: updates }
  )

  console.log(`\n═══════════════════════════════════════════════════════`)
  console.log(`  matchedCount:  ${result.matchedCount}`)
  console.log(`  modifiedCount: ${result.modifiedCount}`)
  console.log(`  Total fields:  ${changeLog.length}`)
  console.log(`═══════════════════════════════════════════════════════`)

  // ═══════════════════════════════════════════════════════════════
  // STEP 4: Verify by reading back key fields
  // ═══════════════════════════════════════════════════════════════
  const updated = await KnowledgeBase.findOne({ _id: kb._id }).lean()
  const c = updated.content

  console.log('\n── VERIFICATION ──')
  console.log(`Address: ${c.about?.address}`)
  console.log(`Type: ${c.about?.type}`)
  console.log(`Level: ${c.about?.level}`)
  console.log(`Pin code: ${c.about?.address?.match(/\d{6}/)?.[0] || 'N/A'}`)
  console.log(`Classrooms: ${c.infrastructure?.totalClassrooms}`)
  console.log(`Teachers: ${c.staff?.totalTeachers} (PGT:${c.staff?.pgt}, TGT:${c.staff?.tgt}, PRT:${c.staff?.prt})`)
  console.log(`Students: ${c.students?.total} (Boys:${c.students?.boys}, Girls:${c.students?.girls})`)
  console.log(`Hostel: ${c.hostel?.gender}`)
  console.log(`Buses: ${c.transport?.buses}`)
  console.log(`Alumni count: ${c.alumni?.length}`)
  console.log(`Fee classes: ${c.fees?.classWise?.length}`)
  console.log(`Fee example (IX-X tuition): ₹${c.fees?.classWise?.find(f => f.classes === 'IX & X')?.tuitionPerMonth}/month`)
  console.log(`UDISE: ${c.about?.udiseCode}`)
  console.log(`Affiliation valid until: ${c.about?.affiliationValidity}`)
  console.log(`VP: ${c.vicePrincipal?.name}`)
  console.log(`Classes from: ${c.classes?.from}`)
  console.log(`Streams: ${c.classes?.streams?.join(', ')}`)

  await mongoose.disconnect()
  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
