// Mongoose schema for 'conversations' collection.
// Fields exactly:
// businessId: ObjectId ref 'Business' required
// resellerId: ObjectId ref 'Reseller' required
// contactId: ObjectId ref 'Contact' required
// phone: String required
// status: String enum ['active','handed_off','resolved','expired'] default 'active'
// vertical: String required
// flowState: {
//   goals: { inquiryUnderstood: Boolean, parentNameCollected: Boolean, studentInfoCollected: Boolean, infoShared: Boolean, visitSuggested: Boolean, contactDetailsCollected: Boolean } all default false,
//   collectedData: { parentName: String, studentName: String, interestedClass: String, preferredVisitTime: String, altPhone: String },
//   handoffTriggered: Boolean default false,
//   handoffAt: Date default null,
//   sentiment: String default 'neutral'
// }
// source: { type: String default 'direct', ctwaClid: String, adId: String, adHeadline: String }
// openedAt: Date default Date.now
// resolvedAt: Date default null
// timestamps: true
// Add indexes: { businessId:1, status:1 }, { businessId:1, contactId:1 }, { contactId:1, openedAt:-1 }
const mongoose = require('mongoose')
const { Schema } = mongoose

const conversationSchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', required: true },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
  phone: { type: String, required: true },
  status: { type: String, enum: ['active','handed_off','resolved','expired'], default: 'active' },
  vertical: { type: String, required: true },
  flowState: {
    goals: {
      inquiryUnderstood: { type: Boolean, default: false },
      parentNameCollected: { type: Boolean, default: false },
      studentInfoCollected: { type: Boolean, default: false },
      infoShared: { type: Boolean, default: false },
      visitSuggested: { type: Boolean, default: false },
        contactDetailsCollected: { type: Boolean, default: false }
    },
    collectedData: {
      parentName: { type: String },
      studentName: { type: String },
      interestedClass: { type: String },
      preferredVisitTime: { type: String },
      altPhone: { type: String }
    },
    handoffTriggered: { type: Boolean, default: false },
    handoffAt: { type: Date, default: null },
    sentiment: { type: String, default: 'neutral' }
  },
  source: {
  sourceType: { type: String, default: 'direct' },
  ctwaClid:   { type: String },
  adId:       { type: String },
  adHeadline: { type: String }
},
  openedAt: { type: Date, default: Date.now },
  resolvedAt: { type: Date, default: null }
}, { timestamps: true })

conversationSchema.index({ businessId: 1, status: 1 })
conversationSchema.index({ businessId: 1, contactId: 1 })
conversationSchema.index({ contactId: 1, openedAt: -1 })

module.exports = mongoose.model('Conversation', conversationSchema)