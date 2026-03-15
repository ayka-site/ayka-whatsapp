/**
 * One-time helper: encrypts WA_ACCESS_TOKEN and stores it in MongoDB.
 * Run: MONGODB_URI=... ENCRYPTION_KEY=... WA_ACCESS_TOKEN=... node scripts/_encrypt-token-once.js
 */
const crypto = require('crypto')
const mongoose = require('mongoose')

const ENC_KEY = process.env.ENCRYPTION_KEY?.trim()
const TOKEN   = process.env.WA_ACCESS_TOKEN?.trim()
const BIZ_ID  = process.env.SPV_BUSINESS_ID || '69a305f398f94563b73c6ef3'

if (!ENC_KEY || !TOKEN) {
  console.error('Usage: MONGODB_URI=... ENCRYPTION_KEY=... WA_ACCESS_TOKEN=... node scripts/_encrypt-token-once.js')
  process.exit(1)
}

const KEY = Buffer.from(ENC_KEY, 'hex')

function encrypt(text) {
  const iv     = crypto.randomBytes(16)
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv)
  const enc    = Buffer.concat([cipher.update(text, 'utf8'), cipher.final()])
  const tag    = cipher.getAuthTag()
  return [iv.toString('hex'), tag.toString('hex'), enc.toString('hex')].join(':')
}

function decrypt(payload) {
  const [ivH, tagH, encH] = payload.split(':')
  const dec = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(ivH, 'hex'))
  dec.setAuthTag(Buffer.from(tagH, 'hex'))
  return Buffer.concat([dec.update(Buffer.from(encH, 'hex')), dec.final()]).toString('utf8')
}

;(async () => {
  const encrypted = encrypt(TOKEN)

  // Verify round-trip before writing
  const plain = decrypt(encrypted)
  if (plain !== TOKEN) { console.error('ROUND TRIP FAILED'); process.exit(1) }
  console.log('Round-trip OK.')

  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected.')

  const db = mongoose.connection.db
  const result = await db.collection('businesses').updateOne(
    { _id: new mongoose.Types.ObjectId(BIZ_ID) },
    { $set: { 'whatsapp.accessToken': encrypted } }
  )
  console.log('DB updated. Modified count:', result.modifiedCount)

  // Verify stored value
  const biz = await db.collection('businesses').findOne(
    { _id: new mongoose.Types.ObjectId(BIZ_ID) },
    { projection: { 'whatsapp.accessToken': 1 } }
  )
  const stored = biz?.whatsapp?.accessToken
  const isEncrypted = stored?.split(':').length === 3
  console.log('Stored as encrypted format:', isEncrypted)

  if (isEncrypted) {
    const verify = decrypt(stored)
    console.log('Decrypt from DB matches original:', verify === TOKEN)
  }

  await mongoose.disconnect()
  console.log('DONE')
})().catch(e => { console.error(e); process.exit(1) })
