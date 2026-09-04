/**
 * One-time script: Encrypt new SPV access token, update DB, clear Redis cache.
 */
require('dotenv').config();
const mongoose = require('mongoose');
const { Business } = require('@ayka/db');
const { encrypt, decrypt } = require('../src/utils/encryption');
const redis = require('../src/config/redis');

const NEW_TOKEN = process.env.WA_ACCESS_TOKEN;
const SPV_ID = process.env.SPV_BUSINESS_ID;
const PHONE_NUMBER_ID = process.env.WA_PHONE_NUMBER_ID || '1021773934354033';

if (!NEW_TOKEN || !SPV_ID) {
  console.error('Usage: WA_ACCESS_TOKEN=<token> SPV_BUSINESS_ID=<businessId> [WA_PHONE_NUMBER_ID=<id>] node scripts/fix-spv-token.js');
  process.exit(1);
}

async function main() {
  await mongoose.connect(process.env.MONGODB_URI);

  // 1. Encrypt
  const encrypted = encrypt(NEW_TOKEN);
  console.log('Encrypted token length:', encrypted.length);

  // 2. Verify round-trip
  const decrypted = decrypt(encrypted);
  if (decrypted !== NEW_TOKEN) {
    console.error('ROUND-TRIP FAILED');
    process.exit(1);
  }
  console.log('Round-trip OK');

  // 3. Update DB
  const result = await Business.updateOne(
    { _id: SPV_ID },
    { $set: { 'whatsapp.accessToken': encrypted } }
  );
  console.log('DB update:', result.modifiedCount === 1 ? 'SUCCESS' : 'FAILED (not modified)');

  // 4. Clear Redis tenant cache
  const cacheKey = `tenant:${PHONE_NUMBER_ID}`;
  await redis.del(cacheKey);
  console.log('Redis cache cleared for', cacheKey);

  // 5. Verify from DB
  const biz = await Business.findById(SPV_ID, { 'whatsapp.accessToken': 1 }).lean();
  const stored = biz.whatsapp.accessToken;
  const isEncrypted = stored.includes(':');
  console.log('Stored token encrypted:', isEncrypted);
  if (isEncrypted) {
    const dec = decrypt(stored);
    console.log('Decrypt from DB matches:', dec === NEW_TOKEN);
  }

  await mongoose.disconnect();
  console.log('DONE');
}

main().catch(e => { console.error(e); process.exit(1); });
