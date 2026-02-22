// Express Router with one GET route at '/health'.
// Return JSON: { status: 'ok', timestamp: new Date().toISOString(), service: 'ayka-api' }
// Status 200.
// Export the router.
const express = require('express')
const router = express.Router()

router.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    timestamp: new Date().toISOString(),
    service: 'ayka-api'
  })
})

module.exports = router