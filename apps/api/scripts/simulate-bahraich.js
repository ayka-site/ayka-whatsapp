/**
 * Simulate 5 test messages from Bahraich parents and print Priya's responses.
 * Also prints the full system prompt for verification.
 */
require('dotenv').config()
const mongoose = require('mongoose')
const { KnowledgeBase } = require('@ayka/db')
const { buildSystemPrompt } = require('../src/core/prompt.builder')
const { callGroq } = require('../src/services/groq.service')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected to MongoDB\n')

  // Load the real KB
  const kb = await KnowledgeBase.findOne({}).lean()
  if (!kb) { console.error('No KB found!'); process.exit(1) }

  const settings = {
    agentName: 'Priya',
    displayName: 'Sant Pathik Vidyalaya',
    handoffPhone: '+919198783830',
  }

  // ═══════════════════════════════════════════════════════════════
  // Part 1: Print full system prompt
  // ═══════════════════════════════════════════════════════════════
  const baseSession = {
    vertical: 'school',
    recentMessages: [],
    flowState: {
      goals: {},
      collectedData: {},
      visitConfirmed: false,
    },
  }

  console.log('═══════════════════════════════════════════════════════')
  console.log('     FULL SYSTEM PROMPT (with updated KB)')
  console.log('═══════════════════════════════════════════════════════\n')

  const fullPrompt = buildSystemPrompt(kb, baseSession, settings, 'hello')
  console.log(fullPrompt)
  console.log('\n═══════════════════════════════════════════════════════\n')

  // ═══════════════════════════════════════════════════════════════
  // Part 2: Simulate 5 test messages
  // ═══════════════════════════════════════════════════════════════
  const testMessages = [
    { msg: 'Assalamu Alaikum', label: 'Islamic greeting' },
    { msg: 'Pranam, school ki fees kitni hai', label: 'Hindu greeting + fees question' },
    { msg: 'हमारे बेटे को कक्षा 6 में दाखिला लेना है', label: 'Pure Hindi Devanagari' },
    { msg: 'CBSE kya hota hai', label: 'School concept question' },
    { msg: 'Aapka school kaisa hai', label: 'General school question' },
  ]

  for (const { msg, label } of testMessages) {
    console.log(`\n─── TEST: "${msg}" (${label}) ───`)

    // Build a fresh session for each test (first message scenario)
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
    const messages = [
      { role: 'user', content: { text: msg } }
    ]

    try {
      const response = await callGroq(systemPrompt, messages)
      // Strip any HANDOFF/VISIT_CONFIRMED signals for clean display
      const clean = response
        .replace(/(^|\n)\s*HANDOFF:\s*YES\s*/gi, '')
        .replace(/(^|\n)\s*VISIT_CONFIRMED:\s*YES\s*/gi, '')
        .trim()
      console.log(`\nPriya: ${clean}`)
    } catch (err) {
      console.error(`  ERROR: ${err.message}`)
    }

    // Small delay between API calls
    await new Promise(r => setTimeout(r, 1000))
  }

  await mongoose.disconnect()
  console.log('\n\nDone.')
}

main().catch(e => { console.error(e); process.exit(1) })
