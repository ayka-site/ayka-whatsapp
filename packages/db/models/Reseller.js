const mongoose = require('mongoose')
const { Schema } = mongoose

const resellerSchema = new Schema({
  name:    { type: String, required: true },
  slug:    { type: String, required: true, unique: true },
  email:   { type: String, required: true },
  phone:   { type: String, default: null },
  pricing: {
    setupCost:    { type: Number, default: 0 },   // one-time system setup fee
    perBotCost:   { type: Number, default: 0 },   // one-time cost per bot
    monthlyPerBot:{ type: Number, default: 0 },   // recurring monthly per bot
    botSlots:     { type: Number, default: 5 },   // max bots allowed
  },
  platformFeeStatus: { type: String, enum: ['paid', 'overdue', 'trial'], default: 'trial' },
  themeConfig: {
    brandName:       { type: String, default: 'Dashboard' },
    logoUrl:         { type: String, default: null },
    primaryColor:    { type: String, default: '#0ea5e9' },
    accentColor:     { type: String, default: '#38bdf8' },
    backgroundColor: { type: String, default: '#f0f9ff' },
    sidebarColor:    { type: String, default: '#ffffff' },
    textColor:       { type: String, default: '#0f172a' },
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
  isActive: { type: Boolean, default: true },
}, { timestamps: true })

module.exports = mongoose.model('Reseller', resellerSchema)
