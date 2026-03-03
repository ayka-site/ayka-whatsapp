/**
 * Clear all WhatsApp session caches from Redis
 * so the new prompt builder takes effect immediately
 */
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const { Redis } = require('@upstash/redis')

async function main() {
  const redis = Redis.fromEnv()

  // Scan for session, tenant, and KB keys
  let cursor = '0'
  const allKeys = []

  do {
    const result = await redis.scan(cursor, { match: 'session:*', count: 100 })
    cursor = String(result[0])
    allKeys.push(...result[1])
  } while (cursor !== '0')

  cursor = '0'
  do {
    const result = await redis.scan(cursor, { match: 'tenant:*', count: 100 })
    cursor = String(result[0])
    allKeys.push(...result[1])
  } while (cursor !== '0')

  cursor = '0'
  do {
    const result = await redis.scan(cursor, { match: 'kb:*', count: 100 })
    cursor = String(result[0])
    allKeys.push(...result[1])
  } while (cursor !== '0')

  console.log(`Found ${allKeys.length} keys to clear`)

  for (const key of allKeys) {
    await redis.del(key)
    console.log(`  Deleted: ${key}`)
  }

  console.log('DONE — all sessions cleared, new prompt will be used')
}

main().catch(e => { console.error(e); process.exit(1) })
