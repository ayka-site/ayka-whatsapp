require('dotenv').config()
const mongoose = require('mongoose')
const logger = require('../utils/logger')

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000,
    })
    logger.info('MongoDB connected')
    return mongoose.connection
  } catch (err) {
    logger.error({ err }, 'MongoDB initial connection failed')
    throw err
  }
}

module.exports = { connectDB }
