// Mongoose schema for 'businesses' collection.
// Fields exactly as follows — do not add extra fields:
// resellerId: ObjectId ref 'Reseller', required
// name: String required
// slug: String required unique
// vertical: String enum ['school','realestate','healthcare','msme'] required
// whatsapp: { phoneNumberId: String required unique, accessToken: String required, wabaId: String required, verifyToken: String required }
// settings: { displayName: String, timezone: String default 'Asia/Kolkata', language: String default 'en', handoffPhone: String }
// subscription: { plan: String default 'basic', status: String default 'active', expiresAt: Date }
// isActive: Boolean default true
// timestamps: true
// Add index on whatsapp.phoneNumberId (unique) and resellerId.
const mongoose = require('mongoose')
const { Schema } = mongoose

const businessSchema = new Schema({
  resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', required: true },
  name:       { type: String, required: true },
  slug:       { type: String, required: true, unique: true },
  vertical:   { type: String, enum: ['school','realestate','healthcare','msme'], required: true },
  whatsapp: {
    phoneNumberId: { type: String, required: true},
    accessToken:   { type: String, required: true },
    wabaId:        { type: String, required: true },
    verifyToken:   { type: String, required: true }
  },
  settings: {
    displayName:  { type: String },
    agentName:    { type: String },
    timezone:     { type: String, default: 'Asia/Kolkata' },
    language:     { type: String, default: 'en' },
    handoffPhone: { type: String }
  },
  subscription: {
    plan: { type: String, default: 'basic' },
    status: { type: String, default: 'active' },
    expiresAt: { type: Date }
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true })

businessSchema.index({ 'whatsapp.phoneNumberId': 1 }, { unique: true })
businessSchema.index({ resellerId: 1 })

module.exports = mongoose.model('Business', businessSchema)
