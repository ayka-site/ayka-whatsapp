require('dotenv').config();
const mongoose = require('mongoose');
const { KnowledgeBase } = require('@ayka/db');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const kb = await KnowledgeBase.findOne({ businessId: '699c2d8d78317f50e82efa62' }).lean();
  if (kb) {
    console.log(JSON.stringify(kb.content, null, 2));
  } else {
    console.log('NOT FOUND');
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
