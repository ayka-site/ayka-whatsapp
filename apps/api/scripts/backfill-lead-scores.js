#!/usr/bin/env node
/**
 * backfill-lead-scores.js — Recompute and persist lead scores for ALL existing conversations
 *
 * Safe to run multiple times (idempotent). Overwrites existing scores with fresh computation.
 * Multi-tenant: processes all businesses. Uses businessId filter on every write.
 *
 * Usage:
 *   node scripts/backfill-lead-scores.js
 *
 * Requires MONGODB_URI in environment (or .env file).
 */

const mongoose = require('mongoose')
const { Conversation, Business } = require('@ayka/db')
const { computeLeadScore } = require('../src/core/scoring.engine')

// ── Load env (if dotenv is available) ──
try { require('dotenv').config() } catch { /* no-op */ }

const MONGODB_URI = process.env.MONGODB_URI
if (!MONGODB_URI) {
  console.error('❌  MONGODB_URI not set. Export it or add to .env')
  process.exit(1)
}

const BATCH_SIZE = 100

async function main() {
  console.log('═══════════════════════════════════════════════════════')
  console.log('  Lead Score Backfill — starting')
  console.log('═══════════════════════════════════════════════════════\n')

  await mongoose.connect(MONGODB_URI)
  console.log('✅  MongoDB connected\n')

  // Build vertical lookup: businessId → vertical
  const businesses = await Business.find({}, { _id: 1, vertical: 1 }).lean()
  const verticalMap = {}
  for (const b of businesses) {
    verticalMap[b._id.toString()] = b.vertical
  }
  console.log(`📊  ${businesses.length} businesses found\n`)

  let totalProcessed = 0
  let totalUpdated   = 0
  let totalSkipped   = 0
  let totalErrored   = 0

  // Process in batches using cursor for memory efficiency
  let lastId = null
  let batchCount = 0

  while (true) {
    const filter = lastId ? { _id: { $gt: lastId } } : {}
    const batch = await Conversation.find(filter)
      .sort({ _id: 1 })
      .limit(BATCH_SIZE)
      .lean()

    if (batch.length === 0) break

    batchCount++
    const bulkOps = []

    for (const convo of batch) {
      totalProcessed++
      const convoId    = convo._id.toString()
      const businessId = convo.businessId?.toString()

      // Resolve vertical: use conversation.vertical first, then business lookup
      const vertical = convo.vertical || verticalMap[businessId]
      if (!vertical) {
        totalSkipped++
        continue
      }

      const flowState = convo.flowState || {}

      try {
        const { score, reason } = computeLeadScore(flowState, vertical)

        // Skip if score is already identical (idempotent optimization)
        if (convo.leadScore === score && convo.leadScoreReason === reason) {
          totalSkipped++
          continue
        }

        bulkOps.push({
          updateOne: {
            filter: { _id: convo._id, businessId: convo.businessId },
            update: {
              $set: {
                leadScore:          score,
                leadScoreReason:    reason,
                leadScoreUpdatedAt: new Date(),
              },
            },
          },
        })
        totalUpdated++
      } catch (err) {
        totalErrored++
        console.error(`  ❌  Error scoring conversation ${convoId}: ${err.message}`)
      }
    }

    // Execute bulk write for this batch
    if (bulkOps.length > 0) {
      await Conversation.bulkWrite(bulkOps, { ordered: false })
    }

    lastId = batch[batch.length - 1]._id
    process.stdout.write(`  Batch ${batchCount}: processed ${batch.length} conversations\r`)
  }

  console.log('\n')
  console.log('═══════════════════════════════════════════════════════')
  console.log('  Lead Score Backfill — complete')
  console.log('═══════════════════════════════════════════════════════')
  console.log(`  Total processed: ${totalProcessed}`)
  console.log(`  Updated:         ${totalUpdated}`)
  console.log(`  Skipped:         ${totalSkipped} (already correct or no vertical)`)
  console.log(`  Errored:         ${totalErrored}`)
  console.log('═══════════════════════════════════════════════════════\n')

  await mongoose.disconnect()
  process.exit(totalErrored > 0 ? 1 : 0)
}

main().catch(err => {
  console.error('Fatal error:', err)
  process.exit(1)
})
