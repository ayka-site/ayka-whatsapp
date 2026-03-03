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
  resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', default: null },
  name:       { type: String, required: true },
  slug:       { type: String, required: true, unique: true },
  vertical:   { type: String, enum: ['school','realestate','healthcare','msme'], required: true },
  pricing: {
    totalPrice:   { type: Number, default: 0 },   // for direct clients (no reseller)
    note:         { type: String, default: '' },   // custom pricing notes
  },
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
  widget: {
    enabled:        { type: Boolean, default: false },
    position:       { type: String, enum: ['bottom-right', 'bottom-left'], default: 'bottom-right' },
    welcomeMessage: { type: String, default: 'Hi there! How can I help you today?' },
    placeholder:    { type: String, default: 'Type a message…' },
    agentName:      { type: String },
    agentAvatar:    { type: String },
    brandName:      { type: String },
    theme: {
      primaryColor:  { type: String, default: '#0ea5e9' },
      headerBg:      { type: String, default: '#0f172a' },
      headerText:    { type: String, default: '#ffffff' },
      chatBg:        { type: String, default: '#f8fafc' },
      userBubble:    { type: String, default: '#0ea5e9' },
      userText:      { type: String, default: '#ffffff' },
      botBubble:     { type: String, default: '#ffffff' },
      botText:       { type: String, default: '#1e293b' },
      fontFamily:    { type: String, default: 'system-ui, -apple-system, sans-serif' },
      borderRadius:  { type: String, default: '16px' },
      buttonSize:    { type: String, default: '60px' },
    },
    allowedOrigins: [{ type: String }],
    collectName:    { type: Boolean, default: true },
    collectEmail:   { type: Boolean, default: false },
    collectPhone:   { type: Boolean, default: false },
    poweredBy:      { type: Boolean, default: true },
  },
  isActive: { type: Boolean, default: true }
}, { timestamps: true })

businessSchema.index({ 'whatsapp.phoneNumberId': 1 }, { unique: true })
businessSchema.index({ resellerId: 1 })

module.exports = mongoose.model('Business', businessSchema)
