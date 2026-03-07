/**
 * SPV PARENT FAQ KB UPDATE
 *
 * Adds generalFAQ (pre-formulated answers for common parent questions)
 * and supporting fields — academicSession, studentTeacherRatio.
 *
 * Source: Verified data directly provided by school (March 2026):
 *   - School Directory, Faculty Details, Students Strength 2025-26,
 *   - Subjects List 2026-27, Activities Calendar, Achievements data
 *
 * Questions covered:
 *   Q6  - Student–teacher ratio
 *   Q9  - Computer education from which class
 *   Q10 - Optional subjects in Class XI
 *   Q12 - Overall development facilities
 *   Q13 - Stream selection before 10th result
 *   Q14 - Academic session start month
 *   Q16 - Important achievements
 *   Q19 - Communication skills facilities
 *
 * Questions NOT answered (data unavailable → bot will handoff):
 *   Q3  - Wing-wise school timings
 *   Q4  - Books/uniform vendor location + contact
 *   Q5  - Number of sections per class
 *   Q11 - Evening tuition for hostel students
 *   Q17 - Admission exam schedule
 *   Q18 - Pre-admission teacher counseling
 *   Q22 - School timings
 *   Q23 - Online fee QR code
 *
 * Run: node scripts/update-kb-parent-faqs.js [businessId]
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
  if (!kb) {
    console.error('No KB found!' + (businessId ? ` (businessId: ${businessId})` : ' Pass businessId as argument or set BUSINESS_ID env var'))
    process.exit(1)
  }
  console.log(`KB _id: ${kb._id}\n`)

  const updates = {}

  // ─────────────────────────────────────────────────────────────
  // Academic session start month (from Activities Calendar)
  // ─────────────────────────────────────────────────────────────
  updates['content.about.academicSession'] = 'April'

  // ─────────────────────────────────────────────────────────────
  // Student-teacher ratio (derived: 1410 students ÷ 64 teachers)
  // ─────────────────────────────────────────────────────────────
  updates['content.staff.studentTeacherRatio'] = 'Approx. 22:1 (1,410 students, 64 qualified teachers — 14 PGTs, 20 TGTs, 30 PRTs)'

  // ─────────────────────────────────────────────────────────────
  // General Parent FAQ — pre-formulated answers
  // These are injected directly into the system prompt so the bot
  // can answer without hallucinating.
  // ─────────────────────────────────────────────────────────────
  updates['content.generalFAQ'] = [
    {
      q: 'Student-teacher ratio kya hai? / What is the student–teacher ratio?',
      a: 'Vidyalaya mein 1,410 students hain aur 64 qualified teachers hain — roughly 22 students per teacher. In mein 14 PGT (Post Graduates), 20 TGT (Trained Graduates), aur 30 PRT (Primary Teachers) hain. Har bacche ko individual attention milti hai.',
    },
    {
      q: 'Academic session kab se shuru hota hai? / From which month does the academic session begin?',
      a: 'Sant Pathik Vidyalaya ka academic session April se shuru hota hai.',
    },
    {
      q: 'Computer education kis class se di jaati hai? / From which class is computer education introduced?',
      a: 'Computer education Pre-Primary level se hi shuru hoti hai. Class I–V mein Computer Education ek elective subject hai. Class VI–VIII mein Computer Education regular hai. Class IX–X mein Information Technology (Code 402) padhaya jaata hai. Class XI–XII mein Computer Science (Code 083) ek optional subject hai. School mein 2 dedicated Computer Laboratories hain, plus ek STEM & Junior Tinkering Lab.',
    },
    {
      q: 'Class 11 mein optional subjects kaunse hain? Hindi, PHE, Computer Science? / Optional subjects in Grade 11?',
      a: 'Class XI–XII mein teeno streams (Science, Commerce, Humanities) mein ek optional subject choose karna hota hai — in teeno mein se: (1) Hindi Core (302), (2) Computer Science (083), (3) Physical Education (048). Science stream mein Physics, Chemistry, Biology ya Maths hain. Commerce mein Accountancy, Business Studies, Economics hain. Humanities mein History, Political Science, Economics hain.',
    },
    {
      q: '10th board result aane se pehle 11th mein stream kaise choose karein? / Stream selection before 10th result declared?',
      a: '10th ka board result aane se pehle provisional admission le sakte hain. School ki counseling team 9th ki marksheet ya pre-board result ke basis pe initial guidance deti hai. Final stream confirmation 10th result aane ke baad hoti hai. Iske liye school mein aakar counseling team se milna sabse achha rahega — woh personally guide karenge.',
    },
    {
      q: 'Sarvangeen vikas ke liye kya hai? / Overall development facilities?',
      a: 'Sant Pathik Vidyalaya mein academics ke saath-saath: Sports Mini Stadium (Devipatan Mandal ka sabse bada, all synthetic grounds), STEM & Junior Tinkering Lab, Smart Board digital classrooms, 8 fully equipped labs (Physics, Chemistry, Biology, 2 Computer labs, Composite Science, Maths, STEM), Music, Art & Craft, Dance, year-round competitions (Extempore, Debate, Quiz, Spell Bee, Storytelling, Mono Acting, Sports tournaments), school transport (22 buses), hostel facility for boys. Ek complete learning environment hai.',
    },
    {
      q: 'Communication skills ke liye kya hai? / Facilities for communication skills?',
      a: 'Communication skills ke liye year-round activities hain: Extempore Speech (Hindi & English dono mein), English Interview Sessions (senior classes ke liye), Group Songs, Storytelling with Props, Mono Acting, Spell Bee, Debate competitions, Quiz. Smart Board aur digital classrooms se confidence naturally develop hoti hai. Yeh sab activities monthly schedule par hoti hain.',
    },
    {
      q: 'School ki important achievements kya hain? / Important achievements of the school?',
      a: 'Kuch key achievements: (1) Aarav Raghuvanshi (Class V) ne Kaun Banega Crorepati mein Hot Seat jeeti — ₹3,20,000 jeete. (2) Vaishnavi Singh (Class XI) ko Central Vigilance Commission ka National Essay Competition Award mila (₹11,000 prize + school se bhi ₹11,000 miliya). (3) District level khelo mein 75% Gold medals — Kabaddi, Chess, Volleyball, Shot Put, 100m, 200m, 400m, 800m, Long Jump mein 1st position. (4) CBSE Cluster mein Kabaddi Runner-Up. (5) Notable alumni: PCS officer, doctors at RML Hospital Lucknow, KGMU, IIT BHU student, Senior Software Engineer in Washington DC USA.',
    },
  ]

  // Apply
  console.log(`Applying ${Object.keys(updates).length} updates...`)
  Object.entries(updates).forEach(([path, val]) => {
    const preview = Array.isArray(val) ? `[Array, ${val.length} items]` : typeof val === 'object' ? '[Object]' : `"${String(val).slice(0, 60)}"`
    console.log(`  ✏️  ${path} = ${preview}`)
  })

  const result = await KnowledgeBase.updateOne({ _id: kb._id }, { $set: updates })

  console.log(`\n════════════════════════════════════════`)
  console.log(`  matched:  ${result.matchedCount}`)
  console.log(`  modified: ${result.modifiedCount}`)
  console.log(`════════════════════════════════════════`)

  // Verify
  const updated = await KnowledgeBase.findOne({ _id: kb._id }).lean()
  const c = updated.content
  console.log('\n── VERIFICATION ──')
  console.log(`Academic session: ${c.about?.academicSession}`)
  console.log(`Student-teacher ratio: ${c.staff?.studentTeacherRatio}`)
  console.log(`General FAQ count: ${c.generalFAQ?.length ?? 0}`)
  c.generalFAQ?.forEach((f, i) => console.log(`  FAQ[${i}]: ${f.q.slice(0, 60)}...`))

  await mongoose.disconnect()
  console.log('\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
