// Connect to MongoDB using MONGODB_URI from process.env.
// Use mongoose.connect with these options: serverSelectionTimeoutMS 5000.
// On successful connection log "MongoDB connected".
// On error log the error and retry after 5 seconds using setTimeout.
// Export a function called connectDB that starts this process.
// Use require('dotenv').config() at the top.
require('dotenv').config()
const mongoose = require('mongoose')

async function connectDB() {
  try {
    await mongoose.connect(process.env.MONGODB_URI, {
      serverSelectionTimeoutMS: 5000
    })
    console.log('MongoDB connected')
  } catch (err) {
    console.error('MongoDB connection error:', err)
    setTimeout(connectDB, 5000)
  }
}

module.exports = { connectDB }
