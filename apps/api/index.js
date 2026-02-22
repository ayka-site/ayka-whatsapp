// Express app entry point.
// require('dotenv').config() first.
// Import validateEnv from './src/config/env' and call it immediately.
// Import connectDB from './src/config/db' and call it.
// Import logger from './src/utils/logger'.
// Set up Express with:
//   - express.json() BUT capture rawBody for webhook signature verification:
//     app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }))
//   - Mount health router at '/'
//   - Mount webhook router at '/'
//   - Global error handler: (err, req, res, next) => log err, return 500 { error: 'Internal server error' }
// Listen on process.env.PORT || 3000.
// Log 'AyKa API running on port X' on start.
// Import routes from './src/routes/health.routes' and './src/routes/webhook.routes'.
require('dotenv').config()
const express = require('express')
const { validateEnv } = require('./src/config/env')
const { connectDB } = require('./src/config/db')
const logger = require('./src/utils/logger')

validateEnv()
connectDB()

const app = express()

app.use(express.json({ verify: (req, res, buf) => { req.rawBody = buf } }))

app.use('/', require('./src/routes/health.routes'))
app.use('/', require('./src/routes/webhook.routes'))

app.use((err, req, res, next) => {
  logger.error(err)
  res.status(500).json({ error: 'Internal server error' })
})

const PORT = process.env.PORT || 3000
app.listen(PORT, () => {
  logger.info(`AyKa API running on port ${PORT}`)
})