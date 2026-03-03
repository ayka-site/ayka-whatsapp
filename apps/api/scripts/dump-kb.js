require('dotenv').config();
const mongoose = require('mongoose');
const { KnowledgeBase } = require('@ayka/db');

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);
  const kb = await KnowledgeBase.findOne({ businessId: '69a305f398f94563b73c6ef3' }).lean();
  if (kb) {
    console.log(JSON.stringify(kb.content, null, 2));
  } else {
    console.log('NO KB FOUND');
  }
  await mongoose.disconnect();
}

main().catch(e => { console.error(e.message); process.exit(1); });
