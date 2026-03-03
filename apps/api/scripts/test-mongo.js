require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') })
const mongoose = require('mongoose')

mongoose.connect(process.env.MONGODB_URI, { serverSelectionTimeoutMS: 15000 })
  .then(() => { console.log('MONGO CONNECTED OK'); process.exit(0) })
  .catch(e => { console.log('MONGO FAILED: ' + e.message); process.exit(1) })
