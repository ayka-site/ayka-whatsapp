#!/usr/bin/env node
/**
 * reset-session.js — Wipe all test data for a phone number
 *
 * Usage:
 *   node scripts/reset-session.js <phone> [businessId]
 *
 * Examples:
 *   node scripts/reset-session.js 918930591051
 *   node scripts/reset-session.js 918930591051 699c2d8d78317f50e82efa62
 *
 * What it clears:
 *   • Redis session key
 *   • MongoDB Conversation(s) for this phone
 *   • MongoDB Messages for those conversations
 *   • MongoDB Contact for this phone
 */

require('dotenv').config()
const mongoose = require('mongoose')
const { Redis } = require('@upstash/redis')

const phone = process.argv[2]
const businessId = process.argv[3] || null

if (!phone) {
  console.error('Usage: node scripts/reset-session.js <phone> [businessId]')
  process.exit(1)
}

// ── Inline minimal models (avoids needing @ayka/db workspace resolution) ─────
const ConversationSchema = new mongoose.Schema({}, { strict: false })
const ContactSchema      = new mongoose.Schema({}, { strict: false })
const MessageSchema      = new mongoose.Schema({}, { strict: false })

const Conversation = mongoose.model('Conversation', ConversationSchema)
const Contact      = mongoose.model('Contact', ContactSchema)
const Message      = mongoose.model('Message', MessageSchema)

async function main() {
  console.log(`\n🔄  Resetting session for phone: ${phone}${businessId ? ` / business: ${businessId}` : ' (all businesses)'}\n`)

  // ── Connect MongoDB ──────────────────────────────────────────────────────
  await mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 5000 })
  console.log('✅  MongoDB connected')

  // ── Connect Redis ────────────────────────────────────────────────────────
  const redis = Redis.fromEnv()

  // ── Build query filter ───────────────────────────────────────────────────
  const filter = businessId ? { phone, businessId: new mongoose.Types.ObjectId(businessId) } : { phone }

  // 1. Find all conversations for this phone
  const conversations = await Conversation.find(filter, { _id: 1 }).lean()
  const convoIds      = conversations.map(c => c._id)
  console.log(`📋  Found ${convoIds.length} conversation(s)`)

  // 2. Delete messages belonging to those conversations
  if (convoIds.length > 0) {
    const msgResult = await Message.deleteMany({ conversationId: { $in: convoIds } })
    console.log(`🗑️   Deleted ${msgResult.deletedCount} message(s)`)
  }

  // 3. Delete conversations
  const convoResult = await Conversation.deleteMany(filter)
  console.log(`🗑️   Deleted ${convoResult.deletedCount} conversation(s)`)

  // 4. Delete contact
  const contactResult = await Contact.deleteMany(filter)
  console.log(`🗑️   Deleted ${contactResult.deletedCount} contact(s)`)

  // 5. Clear Redis session key(s)
  // If businessId given, clear that specific key; otherwise scan for all matching keys
  if (businessId) {
    const key = `session:${businessId}:${phone}`
    await redis.del(key)
    console.log(`🗑️   Cleared Redis key: ${key}`)
  } else {
    // Scan for all session keys for this phone (across all businessIds)
    // Upstash Redis supports SCAN via redis.scan()
    let cursor = 0
    let cleared = 0
    do {
      const [nextCursor, keys] = await redis.scan(cursor, { match: `session:*:${phone}`, count: 100 })
      cursor = Number(nextCursor)
      for (const key of keys) {
        await redis.del(key)
        console.log(`🗑️   Cleared Redis key: ${key}`)
        cleared++
      }
    } while (cursor !== 0)
    if (cleared === 0) console.log('ℹ️   No Redis session keys found for this phone')
  }

  console.log('\n✅  Reset complete. The next message from this number starts fresh.\n')
  await mongoose.disconnect()
  process.exit(0)
}

main().catch(err => {
  console.error('❌  Reset failed:', err.message)
  process.exit(1)
})
