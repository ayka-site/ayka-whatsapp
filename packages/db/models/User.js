const mongoose = require('mongoose')
const { Schema } = mongoose

const userSchema = new Schema({
  email: {
    type: String,
    required: true,
    unique: true,
    lowercase: true,
    trim: true,
    index: true,
  },
  passwordHash: { type: String, required: true, select: false },
  role: {
    type: String,
    enum: ['superadmin', 'reseller', 'client'],
    required: true,
  },
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', default: null },
  resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', default: null },
  displayName: { type: String, required: true },
  themeConfig: {
    brandName:       { type: String, default: 'Dashboard' },
    logoUrl:         { type: String, default: null },
    primaryColor:    { type: String, default: '#6C47FF' },
    accentColor:     { type: String, default: '#a78bfa' },
    backgroundColor: { type: String, default: '#0f0f13' },
    sidebarColor:    { type: String, default: '#18181f' },
    textColor:       { type: String, default: '#f1f5f9' },
    faviconUrl:      { type: String, default: null },
    supportEmail:    { type: String, default: null },
    supportPhone:    { type: String, default: null },
    showPlatformCredit: { type: Boolean, default: false },
    features: {
      showAppointments:      { type: Boolean, default: true },
      showAnalytics:         { type: Boolean, default: true },
      showExport:            { type: Boolean, default: true },
      showLeadScore:         { type: Boolean, default: true },
      showConversations:     { type: Boolean, default: true },
      showActivityFeed:      { type: Boolean, default: true },
      showStaffNotifications:{ type: Boolean, default: true },
      showBotStatus:         { type: Boolean, default: true },
    }
  },
  lastLoginAt: { type: Date, default: null },
  isActive:    { type: Boolean, default: true },
}, { timestamps: true })

userSchema.index({ businessId: 1 })
userSchema.index({ resellerId: 1 })

module.exports = mongoose.model('User', userSchema)
