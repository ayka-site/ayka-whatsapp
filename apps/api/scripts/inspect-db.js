require('dotenv').config();
const mongoose = require('mongoose');
const { KnowledgeBase, Business } = require('@ayka/db');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  
  // List all businesses
  const businesses = await Business.find({}, { _id:1, name:1, slug:1, vertical:1, isActive:1, 'whatsapp.phoneNumberId':1 }).lean();
  console.log('=== BUSINESSES ===');
  for (const b of businesses) {
    console.log(`  ${b._id} | ${b.name} | active=${b.isActive} | phone=${b.whatsapp?.phoneNumberId || 'NONE'}`);
  }

  // List all KBs
  const kbs = await KnowledgeBase.find({}, { _id:1, businessId:1 }).lean();
  console.log('\n=== KNOWLEDGE BASES ===');
  for (const kb of kbs) {
    console.log(`  ${kb._id} | businessId=${kb.businessId}`);
  }

  // Dump SPV KB if exists
  const spv = businesses.find(b => b.name && b.name.includes('Sant Pathik'));
  if (spv) {
    console.log('\n=== SPV Business ID:', spv._id.toString(), '===');
    const spvKb = await KnowledgeBase.findOne({ businessId: spv._id }).lean();
    if (spvKb) {
      console.log('KB CONTENT:');
      console.log(JSON.stringify(spvKb.content, null, 2));
    } else {
      console.log('NO KB for SPV');
      // Try string match
      const spvKb2 = await KnowledgeBase.findOne({ businessId: spv._id.toString() }).lean();
      if (spvKb2) {
        console.log('KB found with string ID:');
        console.log(JSON.stringify(spvKb2.content, null, 2));
      } else {
        console.log('NO KB with string ID either');
      }
    }
  }

  await mongoose.disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
