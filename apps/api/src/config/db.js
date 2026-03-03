require('dotenv').config()
const mongoose = require('mongoose')
const logger   = require('../utils/logger')

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 15000
    })
    logger.info('MongoDB connected')
  } catch (err) {
    logger.error({ err }, 'MongoDB connection error — retrying in 5s')
    setTimeout(connectDB, 5000)
  }
}

module.exports = { connectDB }
