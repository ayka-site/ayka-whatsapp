/**
 * Quick test: just tests 4 & 5 (the ones that timed out)
 */
require('dotenv').config()
const mongoose = require('mongoose')
const { KnowledgeBase } = require('@ayka/db')
const { buildSystemPrompt } = require('../src/core/prompt.builder')
const { callGroq } = require('../src/services/groq.service')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB')

  const kb = await KnowledgeBase.findOne({}).lean()
  if (!kb) { console.error('No KB found!'); process.exit(1) }

  const settings = {
    agentName: 'Priya',
    displayName: 'Sant Pathik Vidyalaya',
    handoffPhone: '+919198783830',
  }

  const testMessages = [
    { msg: 'CBSE kya hota hai', label: 'School concept question' },
    { msg: 'Aapka school kaisa hai', label: 'General school question' },
  ]

  for (const { msg, label } of testMessages) {
    console.log(`\n─── TEST: "${msg}" (${label}) ───`)

    const session = {
      vertical: 'school',
      recentMessages: [],
      flowState: {
        goals: {},
        collectedData: {},
        visitConfirmed: false,
      },
    }

    const systemPrompt = buildSystemPrompt(kb, session, settings, msg)
    const messages = [{ role: 'user', content: { text: msg } }]

    try {
      const response = await callGroq(systemPrompt, messages)
      const clean = response
        .replace(/(^|\n)\s*HANDOFF:\s*YES\s*/gi, '')
        .replace(/(^|\n)\s*VISIT_CONFIRMED:\s*YES\s*/gi, '')
        .trim()
      console.log(`\nPriya: ${clean}`)
    } catch (err) {
      console.error(`  ERROR: ${err.message}`)
    }

    // 3 second delay between calls to avoid rate limits
    await new Promise(r => setTimeout(r, 3000))
  }

  await mongoose.disconnect()
  console.log('\n\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
