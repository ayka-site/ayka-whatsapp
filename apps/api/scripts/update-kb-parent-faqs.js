/**
 * SPV PARENT FAQ KB UPDATE (FINAL)
 *
 * Loads the final parent FAQ set, updates supporting fields,
 * and optionally configures a QR image URL for WhatsApp image sending.
 *
 * Run:
 *   node scripts/update-kb-parent-faqs.js [businessId]
 *
 * Optional env vars:
 *   SPV_QR_IMAGE_URL=<public https image url>
 *   SCHOOL_QR_IMAGE_URL=<public https image url>  (fallback key)
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

  const qrImageUrl = String(process.env.SPV_QR_IMAGE_URL || process.env.SCHOOL_QR_IMAGE_URL || '').trim()
  const qrConfigured = /^https?:\/\//i.test(qrImageUrl)
  const qrAnswer = qrConfigured
    ? 'Ji, school ka official fee payment QR code available hai. Main aapko QR image bhej rahi hoon. Agar payment issue aaye to school office se verify kar sakte hain: +919198783830.'
    : 'School ka official fee payment QR code admissions office se share kiya jaata hai. Kripya +919198783830 par call ya WhatsApp karein; team aapko verified QR turant bhej degi.'

  const generalFAQ = [
    {
      q: 'Who is the Principal? / विद्यालय की प्रिंसिपल कौन हैं?',
      a: 'Principal: Mrs. Puja Agarwal.',
    },
    {
      q: 'Who is the Managing Director? / विद्यालय के मैनेजिंग डायरेक्टर कौन हैं?',
      a: 'Managing Director: Mr. Awadhesh Narayan Agarwal.',
    },
    {
      q: 'What is the school website? / विद्यालय की वेबसाइट क्या है?',
      a: 'Official website: https://www.santpathikvidyalaya.org',
    },
    {
      q: 'What is the age criterion for nursery / pre-primary admission? / नर्सरी या प्री-प्राइमरी में आयु मानदंड क्या है?',
      a: 'Pre-Primary age criteria: Playgroup/Playway: 2–3 years, Nursery: 3–4 years, LKG: 4–5 years, UKG: 5–6 years.',
    },
    {
      q: 'Under which board is the school affiliated? / विद्यालय किस बोर्ड से संबद्ध है?',
      a: 'Sant Pathik Vidyalaya CBSE (Central Board of Secondary Education) se affiliated hai. School Code: 70178. Affiliation Number: 2130176.',
    },
    {
      q: 'How far is the school from Bahraich city? Landmark? / विद्यालय बहराइच शहर से कितनी दूरी पर है?',
      a: 'School Pashupati Nagar, Lucknow Road par hai. Yeh Navodaya Vidyalaya se lagbhag 1 km door hai. Mari Mata se approx 8.1 km (road se kareeb 11 minute) hai.',
    },
    {
      q: 'Are timings same for Pre-Primary, Primary, Senior wings? / क्या सभी विंग का समय समान है?',
      a: 'Haan, Pre-Primary, Primary aur Senior sabhi wings ke liye same school timing follow hoti hai (season ke hisaab se summer/winter timing apply hoti hai).',
    },
    {
      q: 'Where to buy books and uniforms? / किताबें और यूनिफॉर्म कहाँ मिलेंगी?',
      a: 'Books aur uniforms yahan milte hain: Agarwal Gift Gallery, Peepal Chauraha. Contact Number: 9792641527.',
    },
    {
      q: 'How many sections are there in each class? / प्रत्येक कक्षा में कितने सेक्शन होते हैं?',
      a: 'Sections class strength ke hisaab se banaye jaate hain, taaki effective teacher-student ratio maintain rahe.',
    },
    {
      q: 'What is the student-teacher ratio? / शिक्षक-छात्र अनुपात क्या है?',
      a: 'School balanced teacher-student ratio maintain karta hai by class-wise section planning. Current staff strength: 64 qualified teachers (14 PGT, 20 TGT, 30 PRT) for 1,410 students.',
    },
    {
      q: 'Which streams are available in Grade 11? / कक्षा 11 में कौन-कौन से स्ट्रीम हैं?',
      a: 'Grade 11 mein 3 streams available hain: Science, Commerce, Humanities.',
    },
    {
      q: 'Sports proficiency facilities? / खेलों में दक्ष बनाने के लिए क्या सुविधाएँ हैं?',
      a: 'Regular sports classes hoti hain. Campus mein Mini Stadium (Patan Devi Mandal region ka pehla school mini stadium) develop ho raha hai. School ne Khelo Bahraich Khelo 2.0 mein strong performance diya, CBSE Cluster (2025-26) mein 2 medals jeete, aur students ne national-level achievements bhi hasil ki hain.',
    },
    {
      q: 'From which class is computer education introduced? / कंप्यूटर शिक्षा किस कक्षा से शुरू होती है?',
      a: 'Basic computer concepts Pre-Primary se introduce hote hain. Formal computer education Class 1 se start hoti hai. Classes 1-5 ke liye Junior Tinkering Lab aur Classes 6-12 ke liye Advanced STEM Labs available hain.',
    },
    {
      q: 'Optional subjects in Grade 11? / कक्षा 11 में वैकल्पिक विषय कौन-कौन से हैं?',
      a: 'Optional subjects: Hindi, Physical Education (PHE), Computer Science. Student inme se ek optional choose karte hain.',
    },
    {
      q: 'Is evening tuition available for hostel students? / क्या हॉस्टल छात्रों के लिए शाम की ट्यूशन है?',
      a: 'Haan, hostel students ke liye evening study aur tuition sessions arranged hote hain to support academics.',
    },
    {
      q: 'How does school support overall development? / सर्वांगीण विकास के लिए क्या व्यवस्था है?',
      a: 'Holistic development ke liye NEP 2020 aligned activities, digital boards in all classrooms, communication/personality development focus, advanced computer ecosystem (Junior Tinkering + STEM labs), aur experienced faculty support diya jaata hai.',
    },
    {
      q: 'How to choose stream before Class 10 board result? / 10वीं परिणाम से पहले 11वीं स्ट्रीम कैसे चुनें?',
      a: 'Students pre-board performance ke basis par provisional stream choose kar sakte hain. Final guidance ke liye experienced teachers ke counseling sessions available hain.',
    },
    {
      q: 'From which month does academic session begin? / शैक्षणिक सत्र कब शुरू होता है?',
      a: 'Academic session April se start hota hai, traditional Vidyarambh Ceremony ke saath.',
    },
    {
      q: 'Subjects in Science, Commerce, Humanities streams? / विज्ञान, कॉमर्स, ह्यूमैनिटीज में विषय?',
      a: 'Science: Biology/Mathematics, Physics, Chemistry, English Core + optional (Hindi/PHE/Computer Science). Commerce: Economics, Business Studies, Accountancy, English Core + optional (Hindi/PHE/Computer Science). Humanities: English, Political Science, Economics, History + optional (Hindi/PHE/Computer Science).',
    },
    {
      q: 'When is entrance exam conducted for admission? / प्रवेश परीक्षा कब होती है?',
      a: 'Pehle school office se admission form lekar registration karna hota hai. Registration ke baad student admission test ke liye eligible hota hai.',
    },
    {
      q: 'Is pre-admission counseling available? / क्या प्रवेश से पहले काउंसलिंग मिलती है?',
      a: 'Haan, experienced teachers parents aur students ke liye pre-admission counseling sessions provide karte hain.',
    },
    {
      q: 'How are communication skills improved? / कम्युनिकेशन स्किल कैसे बेहतर की जाती है?',
      a: 'Regular English speaking activities, debates, presentations, group discussions, classroom participation, interactive learning aur personality development sessions ke through communication improve ki jaati hai.',
    },
    {
      q: 'What is the school UDISE code? / विद्यालय का UDISE कोड क्या है?',
      a: 'UDISE Code: 09500707504.',
    },
    {
      q: 'Up to which class does the school provide education? / विद्यालय में किस कक्षा तक पढ़ाई होती है?',
      a: 'School Play Group (PG) se Class 12 tak education provide karta hai aur 35+ saal se academic service de raha hai.',
    },
    {
      q: 'What are the school timings? / विद्यालय का समय क्या है?',
      a: 'Summer timing: 8:00 AM – 1:30 PM. Winter timing: 9:00 AM – 2:30 PM. Timings government instructions ke hisaab se update ho sakte hain.',
    },
    {
      q: 'Do you provide bus facility? What are stoppage-wise transport charges? / बस सुविधा और स्टॉपेज अनुसार शुल्क क्या है?',
      a: 'Haan, school transport available hai. Stoppage-wise conveyance fee effective from 1 April 2026 ke hisaab se liya jaata hai. Main aapko stop-wise amount bata sakti hoon.',
    },
    {
      q: 'Hostel mein admission ke time kaun-kaun se items laane hote hain? / हॉस्टल के लिए क्या-क्या सामान लाना होता है?',
      a: 'Admission ke time boarders ke liye clothing aur daily-use checklist follow hoti hai (shirts, pants, socks, shoes, toiletries, bedding, winter items, etc.). Full item-wise list school office se verify kar sakte hain.',
    },
    {
      q: 'Hostel fee installment plan kya hai? / हॉस्टल फीस की इंस्टॉलमेंट योजना क्या है?',
      a: 'Hostel fee plans total amount ke hisaab se 4 installments mein liye jaate hain (1st to 4th installment windows). Aap desired plan ke hisaab se exact breakup le sakte hain.',
    },
    {
      q: 'Provide school QR code / विद्यालय का QR code बताएँ',
      a: qrAnswer,
    },
  ]

  const updates = {}

  // Supporting structured fields (so prompt + API both stay consistent)
  updates['content.about.academicSession'] = 'April'
  updates['content.about.udiseCode'] = '09500707504'
  updates['content.about.website'] = 'https://www.santpathikvidyalaya.org'
  updates['content.about.manager'] = 'Mr. Awadhesh Narayan Agarwal'
  updates['content.about.principalName'] = 'Mrs. Puja Agarwal'
  updates['content.management'] = {
    managingDirector: 'Mr. Awadhesh Narayan Agarwal',
    principal: 'Mrs. Puja Agarwal',
  }
  updates['content.admissionAgeCriteria'] = {
    title: 'Pre-Primary Admission Age Criteria',
    entries: [
      { class: 'Playgroup / Playway', age: '2 – 3 years' },
      { class: 'Nursery', age: '3 – 4 years' },
      { class: 'LKG (Lower Kindergarten)', age: '4 – 5 years' },
      { class: 'UKG (Upper Kindergarten)', age: '5 – 6 years' },
    ],
  }
  updates['content.staff.studentTeacherRatio'] = 'Balanced via sectioning as per class strength; 64 teachers for 1,410 students'
  updates['content.timing.schoolHours'] = 'Summer: 8:00 AM – 1:30 PM; Winter: 9:00 AM – 2:30 PM (subject to government directives)'
  updates['content.transport'] = {
    title: 'Conveyance Fee',
    effectiveFrom: '1st April 2026',
    note: 'Stoppage-wise monthly transport fee.',
    stops: [
      { station: 'Arasanhapurwa', amount: 1000 },
      { station: 'Badrauli', amount: 1800 },
      { station: 'Bahraich', amount: 1800 },
      { station: 'Baira', amount: 1700 },
      { station: 'Beldara', amount: 1500 },
      { station: 'Bhakla', amount: 1800 },
      { station: 'Bhinga Stand', amount: 2000 },
      { station: 'Buddhijot', amount: 1000 },
      { station: 'Fakharpur', amount: 1300 },
      { station: 'Gajadharpur', amount: 1400 },
      { station: 'Hardiya Mod', amount: 1300 },
      { station: 'Harinagar', amount: 1400 },
      { station: 'Ibrahim Deeha', amount: 1100 },
      { station: 'J.N.V', amount: 1800 },
      { station: 'Jaita', amount: 1600 },
      { station: 'Jaitapur Kasba', amount: 1900 },
      { station: 'Jarwal Road', amount: 2000 },
      { station: 'Jihura Maraucha', amount: 1200 },
      { station: 'Kaiserganj', amount: 1800 },
      { station: 'Kesavpur', amount: 1000 },
      { station: 'Khiria', amount: 1100 },
      { station: 'Kodahi', amount: 1500 },
      { station: 'Kothwal', amount: 1700 },
      { station: 'Kundasar', amount: 1700 },
      { station: 'Lalpurwa', amount: 1400 },
      { station: 'Madan Kothi', amount: 1000 },
      { station: 'Mathaura', amount: 1800 },
      { station: 'Nandpur', amount: 1900 },
      { station: 'Nawabganj', amount: 1700 },
      { station: 'Nausahra', amount: 1500 },
      { station: 'Pakauri', amount: 1400 },
      { station: 'Pateriya', amount: 1300 },
      { station: 'Ratesiya', amount: 1600 },
      { station: 'Risiya', amount: 2100 },
      { station: 'Roundopur', amount: 1900 },
      { station: 'Sabhapur', amount: 1800 },
      { station: 'Shivpura (Dokeri)', amount: 1300 },
      { station: 'Siddha', amount: 1800 },
      { station: 'Samda', amount: 1800 },
      { station: 'Sonari Bangla', amount: 1900 },
      { station: 'Tikore Mod', amount: 1500 },
      { station: 'Warganj', amount: 1700 },
    ],
  }
  updates['content.hostelBoarderChecklist'] = {
    title: 'List of clothing and daily use items for boarders at the time of admission',
    clothingAndBasics: [
      { item: 'School Shirt Half Sleeves', quantity: '02' },
      { item: 'School Shirt Full Sleeves', quantity: '02' },
      { item: 'School Pant', quantity: '04' },
      { item: 'School White Lower', quantity: '03' },
      { item: 'Hostel Uniform', quantity: '02 Set' },
      { item: 'Single Bedsheet with pillow colour', quantity: '02 Set' },
      { item: 'Handkerchief', quantity: '04' },
      { item: 'School House Belt', quantity: '02 Set' },
      { item: 'Bath Towel (Dark Colour)', quantity: '02' },
      { item: 'Blue Socks', quantity: '02' },
      { item: 'White Socks', quantity: '02' },
      { item: 'Under garments', quantity: '04 Pair' },
      { item: 'Black Shoes', quantity: '01 Pair' },
      { item: 'P.T. Shoes', quantity: '01 Pair' },
      { item: 'Sports Shoes', quantity: '01 Pair' },
      { item: 'Shoe Brush', quantity: '01' },
      { item: 'Black & White Polish', quantity: '01 Each' },
      { item: 'Bathroom Slipper', quantity: '01 Pair' },
      { item: 'Yonex', quantity: '01' },
      { item: 'School Bag', quantity: '01' },
      { item: 'Bucket/Mug', quantity: '01 Each' },
    ],
    toiletriesAndDailyUse: [
      { item: 'Bathing Soap', quantity: '04' },
      { item: 'Soap Case', quantity: '02' },
      { item: 'Tooth Paste', quantity: '01' },
      { item: 'Tooth Brush', quantity: '01' },
      { item: 'Tongue Cleaner', quantity: '01' },
      { item: 'Hair Oil Bottle', quantity: '01' },
      { item: 'Comb', quantity: '01' },
      { item: 'Talcum Powder', quantity: '01' },
      { item: 'Vaseline', quantity: '01' },
      { item: 'Shampoo Bottle', quantity: '01' },
      { item: 'Body Lotion', quantity: '01' },
      { item: 'Hangers', quantity: '06' },
      { item: 'Nail Cutter', quantity: '01' },
      { item: 'Water Bottle', quantity: '01' },
      { item: 'Lock', quantity: '01' },
    ],
    winterItems: [
      { item: 'School Blazer', quantity: '01' },
      { item: 'School Cap', quantity: '01' },
      { item: 'Sweater/Shirt/Jacket', quantity: '01' },
      { item: 'Quilt/Blanket', quantity: '01' },
    ],
    note: 'Colour house t-shirt is provided/purchased after house allotment and can be purchased later.',
  }
  updates['content.hostelFeeInstallmentPlans'] = {
    note: 'Hostel installment windows as provided by school.',
    windows: {
      firstInstallment: 'At the time of admission up to 3rd April',
      secondInstallment: 'Up to 30th June',
      thirdInstallment: 'Up to 30th September',
      fourthInstallment: 'Up to 30th November',
    },
    plans: [
      { total: 105000, first: 35000, second: 30000, third: 20000, fourth: 20000 },
      { total: 110000, first: 35000, second: 35000, third: 20000, fourth: 20000 },
      { total: 115000, first: 35000, second: 35000, third: 25000, fourth: 20000 },
      { total: 130000, first: 40000, second: 35000, third: 30000, fourth: 25000 },
      { total: 180000, first: 70000, second: 40000, third: 40000, fourth: 30000 },
    ],
  }
  updates['content.uniformBookVendor'] = {
    name: 'Agarwal Gift Gallery',
    location: 'Peepal Chauraha',
    contactNumber: '9792641527',
  }
  updates['content.onlinePaymentQR'] = {
    enabled: qrConfigured,
    imageUrl: qrConfigured ? qrImageUrl : null,
    caption: 'Sant Pathik Vidyalaya official fee payment QR code',
    note: qrConfigured
      ? 'Scan this official school QR for fee payment. Always verify school name before payment.'
      : 'Official QR image not configured in system yet. Share via admissions office on request.',
    contactPhone: '+919198783830',
    updatedAt: new Date().toISOString(),
  }
  updates['content.generalFAQ'] = generalFAQ

  console.log(`Applying ${Object.keys(updates).length} updates...`)
  Object.entries(updates).forEach(([path, val]) => {
    const preview = Array.isArray(val)
      ? `[Array, ${val.length} items]`
      : typeof val === 'object'
        ? '[Object]'
        : `"${String(val).slice(0, 80)}"`
    console.log(`  ✏️  ${path} = ${preview}`)
  })

  const result = await KnowledgeBase.updateOne({ _id: kb._id }, { $set: updates })

  try {
    const redis = require('../src/config/redis')
    const cacheKey = `kb:${kb.businessId}`
    await redis.del(cacheKey)
    console.log(`\n✅ Cleared Redis KB cache: ${cacheKey}`)
  } catch (cacheErr) {
    console.log(`\n⚠️  Could not clear Redis KB cache locally: ${cacheErr.message}`)
  }

  console.log('\n════════════════════════════════════════')
  console.log(`  matched:  ${result.matchedCount}`)
  console.log(`  modified: ${result.modifiedCount}`)
  console.log('════════════════════════════════════════')

  const updated = await KnowledgeBase.findOne({ _id: kb._id }).lean()
  const c = updated.content || {}
  console.log('\n── VERIFICATION ──')
  console.log(`Academic session: ${c.about?.academicSession}`)
  console.log(`UDISE: ${c.about?.udiseCode}`)
  console.log(`School hours: ${c.timing?.schoolHours}`)
  console.log(`General FAQ count: ${c.generalFAQ?.length ?? 0}`)
  console.log(`QR enabled: ${c.onlinePaymentQR?.enabled ? 'yes' : 'no'}`)
  if (c.onlinePaymentQR?.imageUrl) console.log(`QR image URL: ${c.onlinePaymentQR.imageUrl}`)
  c.generalFAQ?.forEach((f, i) => console.log(`  FAQ[${i + 1}]: ${f.q.slice(0, 75)}...`))

  await mongoose.disconnect()
  console.log('\nDone.')
}

main().catch(e => {
  console.error(e)
  process.exit(1)
})
