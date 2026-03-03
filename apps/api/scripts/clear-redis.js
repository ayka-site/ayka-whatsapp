require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const { Redis } = require('@upstash/redis')
const redis = Redis.fromEnv()

;(async () => {
  const patterns = ['session:*', 'tenant:*', 'kb:*']
  let total = 0
  for (const pat of patterns) {
    let cursor = '0'
    do {
      const r = await redis.scan(cursor, { match: pat, count: 100 })
      cursor = String(r[0])
      for (const k of r[1]) {
        await redis.del(k)
        total++
        process.stdout.write('.')
      }
    } while (cursor !== '0')
  }
  console.log('\nCleared ' + total + ' keys')
})()
