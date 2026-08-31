const test = require('node:test')
const assert = require('node:assert/strict')

const { formatParentReply } = require('../src/services/parent.reply.formatter')

test('parent reply strips emojis and normalizes markdown bold to whatsapp bold', () => {
  const result = formatParentReply('✅ **Fees:** ₹1800\n🙏 __Timing:__ 8 AM – 2 PM')

  assert.equal(result.includes('✅'), false)
  assert.equal(result.includes('🙏'), false)
  assert.equal(result.includes('**'), false)
  assert.match(result, /\*Fees:\*/)
  assert.match(result, /\*Timing:\*/)
})

test('parent reply removes leaked control markers', () => {
  const result = formatParentReply([
    'School is open until 2 PM.',
    'HANDOFF: YES',
    'NAME_PARENT: Test Parent',
    'VISIT_CONFIRMED: 2026-09-01 10:30',
  ].join('\n'))

  assert.equal(result, 'School is open until 2 PM.')
})

test('parent reply removes markdown headings and collapses excessive spacing', () => {
  const result = formatParentReply('## Details\n\n\n  Hostel   is available.   \n')
  assert.equal(result, 'Details\n\n Hostel is available.')
})

test('single-asterisk whatsapp bold is preserved', () => {
  const result = formatParentReply('The *monthly fee* is ₹1800.')
  assert.equal(result, 'The *monthly fee* is ₹1800.')
})
