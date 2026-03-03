/**
 * Create KB for SPV (69a305f398f94563b73c6ef3) by copying from test school KB
 * and adding hostel FAQ, simplified fees, improved hostel section.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { KnowledgeBase } = require('@ayka/db');
const redis = require('../src/config/redis');

const SPV_BIZ_ID = '69a305f398f94563b73c6ef3';
const TEST_BIZ_ID = '699c2d8d78317f50e82efa62';

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // 1. Load existing test school KB
  const existing = await KnowledgeBase.findOne({ businessId: TEST_BIZ_ID }).lean();
  if (!existing) { console.error('Source KB not found'); process.exit(1); }

  const content = JSON.parse(JSON.stringify(existing.content));

  // 2. Add comprehensive hostel section (replacing minimal summary)
  content.hostel = {
    available: true,
    gender: "Boys only",
    summary: "Boarding facility for boys with affordable shared dormitories, clean and hygienic mess, 24×7 security, visiting doctor, yoga, sports activities, organized educational tours and excursions",
    meals: {
      count: 4,
      types: ["Breakfast (nashta)", "Lunch (dopahar ka khana)", "Evening snack (shaam ka nashta)", "Dinner (raat ka khana)"],
      dietary: "Pure vegetarian campus — only veg food served. Non-veg food is NOT available.",
      menu: "Menu rotates weekly with balanced nutrition. Includes roti, chawal, dal, sabzi, salad, dahi, seasonal fruits."
    },
    breakfast: "Nashta mein poha / bread-butter-jam / paratha / daliya / upma milta hai chai/doodh ke saath. Seasonal fruits bhi milte hain.",
    routine: {
      wakeUp: "5:30 AM",
      morningYoga: "6:00 AM – 6:30 AM",
      breakfast: "6:30 AM – 7:15 AM",
      schoolHours: "7:30 AM – 2:30 PM (as per school schedule)",
      lunch: "2:30 PM – 3:15 PM",
      rest: "3:15 PM – 4:00 PM",
      eveningSnack: "4:00 PM – 4:30 PM",
      sportsActivities: "4:30 PM – 5:30 PM",
      studyHours: "6:00 PM – 8:00 PM (supervised self-study / tuition)",
      dinner: "8:00 PM – 8:45 PM",
      freeTime: "8:45 PM – 9:30 PM",
      lightsOff: "9:30 PM",
      summary: "Bachche subah 5:30 baje uthte hain. Yoga, nashta, phir school. Dopahar ko khana, aaram, shaam ko khelna, phir 2 ghante padhai (6 se 8 baje). Raat ka khana 8 baje, 9:30 baje sone ka time."
    },
    supervision: {
      nightCare: "Hostel warden aur caretaker 24 ghante rehte hain. Raat ko agar bachche ko washroom jaana ho toh warden/caretaker saath jaata hai. Chhote bachcho ka khaas dhyan rakha jaata hai.",
      security: "24×7 security guard, CCTV cameras, entry register"
    },
    medical: {
      doctor: "School mein ek qualified MBBS doctor niyukt hain jo shaam ko alternate days school aate hain. Emergency mein turant dawai di jaati hai, doctor se phone pe salah li jaati hai, aur zaroorat padne par bachche ko hospital le jaaya jaata hai aur parents ko turant suchit kiya jaata hai.",
      hospitalCare: "Agar bachche ko hospital mein bhejna pade toh school ka ek staff member bachche ke saath hospital mein rehta hai jab tak parents nahi aa jaate.",
      firstAid: "First aid kit har floor pe available hai"
    },
    items: "Hostel mein bachche ko milta hai: bed, mattress, pillow, almirah (cupboard), study table-chair, fan, light, paani ki suvidha. Bedsheet aur blanket apna laana hota hai.",
    roomType: "Shared dormitory style rooms with 4-6 students per room",
    fees: "Hostel fees ke liye school visit karein ya isi number pe call karein — +919198783830. Fees structure personally batayi jaati hai.",
    installments: "Hostel fees ki installment ki jaankari ke liye school office visit karein ya +919198783830 pe call karein.",
    visitInfo: "Aap hostel ki facilities — rooms, washrooms, dining area, playground — sab dekhne ke liye school visit kar sakte hain. Office hours: Monday to Saturday, 9 AM to 4 PM."
  };

  // 3. Add simplified fee summary for parents (in addition to detailed class-wise)
  content.feeSimplified = {
    note: "Yeh approximate monthly total hai — admission ke time additional fee alag se ek baar deni hoti hai.",
    perClass: [
      { classes: "Play Group", monthlyTotal: "₹1,600/month tuition + ₹2,500 ek baar additional + ₹1,000 annual = milake lagbhag ₹1,900/month (additional ek baar mein dena hai)" },
      { classes: "Nursery to UKG", monthlyTotal: "₹1,200/month tuition + ₹2,500 ek baar additional + ₹1,000 annual = lagbhag ₹1,500/month" },
      { classes: "Class 1-3", monthlyTotal: "₹1,500/month tuition + ₹2,500 additional + ₹1,000 annual = lagbhag ₹1,800/month" },
      { classes: "Class 4-5", monthlyTotal: "₹1,600/month tuition + ₹2,500 additional + ₹1,000 annual = lagbhag ₹1,900/month" },
      { classes: "Class 6", monthlyTotal: "₹1,800/month tuition + ₹3,000 additional + ₹1,000 annual = lagbhag ₹2,150/month" },
      { classes: "Class 7-8", monthlyTotal: "₹2,000/month tuition + ₹3,000 additional + ₹1,000 annual = lagbhag ₹2,350/month" },
      { classes: "Class 9-10", monthlyTotal: "₹2,750/month tuition + ₹5,000 additional + ₹3,000 annual = lagbhag ₹3,400/month" },
      { classes: "Class 11-12", monthlyTotal: "₹3,300/month tuition + ₹7,000 additional + ₹5,000 annual = lagbhag ₹4,300/month" }
    ],
    additionalNote: "Additional fee aur annual fee ek baar deni hoti hai, monthly nahi. Exam fee alag hai. Total monthly kharcha sirf tuition fee hai. Baaki saal mein ek baar dena hota hai."
  };

  // 4. Add hostel FAQ section
  content.hostelFAQ = [
    {
      q: "Subah nashte mein kya milta hai? / What does my child get in morning breakfast?",
      a: "Nashta mein poha, bread-butter-jam, paratha, daliya ya upma milta hai chai/doodh ke saath. Seasonal fruits bhi diye jaate hain."
    },
    {
      q: "Bachche ka poore din ka routine kya hoga? / What will be the full day routine?",
      a: "5:30 AM uthna, 6 baje yoga, 6:30 nashta, 7:30-2:30 school, 2:30 lunch, 4 baje snack, 4:30-5:30 sports, 6-8 PM padhai/tuition, 8 PM dinner, 9:30 PM sona."
    },
    {
      q: "Din mein kitni baar khana milta hai? / How many meals in a day?",
      a: "Din mein 4 baar khana milta hai — subah nashta, dopahar ka khana, shaam ka nashta, aur raat ka khana."
    },
    {
      q: "Raat ko washroom jaana ho toh koi saath jaata hai? / Night washroom accompaniment?",
      a: "Ji haan, hostel warden aur caretaker 24 ghante rehte hain. Raat ko chhote bachcho ko washroom le jaane ke liye warden/caretaker hamesha available rehte hain."
    },
    {
      q: "Hostel mein bachche ko kya kya milega? / What will my child get in hostel?",
      a: "Bed, mattress, pillow, almirah (cupboard), study table-chair, fan, light, paani ki suvidha. Bedsheet aur blanket apna laana hota hai."
    },
    {
      q: "Hostel facilities dekhni hain — rooms, washroom, dining area? / Can I visit hostel?",
      a: "Ji bilkul, aap school visit karke hostel ki saari facilities dekh sakte hain — rooms, washrooms, dining area, playground sab. Office hours: Monday-Saturday, 9 AM-4 PM."
    },
    {
      q: "Sone aur uthne ka time kya hai? / Sleeping and waking-up time?",
      a: "Sone ka time raat 9:30 PM hai aur uthne ka time subah 5:30 AM."
    },
    {
      q: "Classes ke baad kitne ghante padhai hoti hai? / After-class study hours?",
      a: "Shaam ko 6 PM se 8 PM tak 2 ghante supervised self-study/tuition hoti hai."
    },
    {
      q: "Tuition/coaching kitne ghante ki hoti hai? / Coaching hours?",
      a: "Roz 2 ghante (6 PM - 8 PM) supervised padhai hoti hai jismein teachers available rehte hain doubts clear karne ke liye."
    },
    {
      q: "Hostel ki fees kya hai? / Hostel fee structure?",
      a: "Hostel fees ki jaankari ke liye school visit karein ya +919198783830 pe call karein. Fees structure personally batayi jaati hai."
    },
    {
      q: "Hostel fees kitni installment mein bhar sakte hain? / Installment plan?",
      a: "Installment ki jaankari ke liye school office visit karein ya +919198783830 pe call karein."
    },
    {
      q: "Emergency mein doctor ya medical facility hai? / Emergency medical facility?",
      a: "Ji haan, school mein ek qualified MBBS doctor niyukt hain jo shaam ko alternate days aate hain. Emergency mein turant dawai di jaati hai, doctor se phone pe salah li jaati hai, aur zaroorat padne par bachche ko hospital le jaaya jaata hai aur parents ko turant suchit kiya jaata hai."
    },
    {
      q: "Hospital mein bachche ka dhyan kaun rakhega? / Who takes care in hospital?",
      a: "Agar bachche ko hospital jaana pade toh school ka ek staff member bachche ke saath hospital mein rehta hai jab tak parents nahi aa jaate."
    },
    {
      q: "Charon waqt ka menu kya hai? / Menu for all 4 meals?",
      a: "Menu weekly rotate hota hai — roti, chawal, dal, sabzi, salad, dahi, seasonal fruits. Balanced nutrition ka dhyan rakha jaata hai. Specific weekly menu school office se mil sakta hai."
    },
    {
      q: "Non-veg khana milta hai? / Do you provide non-veg food?",
      a: "Nahi, yeh pure vegetarian campus hai. Sirf shakahari (veg) khana diya jaata hai. Non-veg food available nahi hai."
    }
  ];

  // 5. Update handoff phone to the correct one
  content.handoff.staffPhone = "+919198783830";

  // 6. Check if KB already exists for SPV
  const existingSpv = await KnowledgeBase.findOne({ businessId: SPV_BIZ_ID });
  if (existingSpv) {
    await KnowledgeBase.updateOne({ businessId: SPV_BIZ_ID }, { $set: { content } });
    console.log('Updated existing SPV KB');
  } else {
    await KnowledgeBase.create({
      businessId: SPV_BIZ_ID,
      resellerId: '69a305f398f94563b73c6eef', // WellTechUp reseller
      vertical: 'school',
      content
    });
    console.log('Created new SPV KB');
  }

  // 7. Clear Redis KB cache
  await redis.del(`kb:${SPV_BIZ_ID}`);
  console.log('Redis KB cache cleared');

  // 8. Verify
  const verify = await KnowledgeBase.findOne({ businessId: SPV_BIZ_ID }).lean();
  console.log('SPV KB verified:', verify ? 'EXISTS' : 'MISSING');
  console.log('Content keys:', Object.keys(verify.content).join(', '));
  console.log('Hostel FAQ count:', verify.content.hostelFAQ?.length || 0);
  console.log('Fee simplified entries:', verify.content.feeSimplified?.perClass?.length || 0);

  await mongoose.disconnect();
  console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
