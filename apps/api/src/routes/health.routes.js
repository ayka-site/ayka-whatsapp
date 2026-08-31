const express = require('express')
const mongoose = require('mongoose')
const redis = require('../config/redis')

const router = express.Router()

function withTimeout(promise, timeoutMs) {
  return Promise.race([
    promise,
    new Promise((_, reject) => {
      const timer = setTimeout(() => reject(new Error('timeout')), timeoutMs)
      if (typeof timer.unref === 'function') timer.unref()
    }),
  ])
}

router.get('/live', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'ayka-api',
  })
})

router.get('/health', async (req, res) => {
  const mongoReady = mongoose.connection.readyState === 1
  let redisReady = false

  try {
    redisReady = (await withTimeout(redis._client.ping(), 1200)) === 'PONG'
  } catch (_) {
    redisReady = false
  }

  const ready = mongoReady && redisReady
  return res.status(ready ? 200 : 503).json({
    status: ready ? 'ok' : 'degraded',
    timestamp: new Date().toISOString(),
    service: 'ayka-api',
    dependencies: {
      mongodb: mongoReady ? 'ready' : 'unavailable',
      redis: redisReady ? 'ready' : 'unavailable',
    },
  })
})

module.exports = router
