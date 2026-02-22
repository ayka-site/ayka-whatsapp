// Mongoose schema for 'contacts' collection.
// Fields exactly:
// businessId: ObjectId ref 'Business' required
// resellerId: ObjectId ref 'Reseller' required
// phone: String required
// name: String default null
// profile: { studentName: String, interestedClass: String, altPhone: String, email: String } all optional
// tags: [String] default []
// optedIn: Boolean default true
// firstContactAt: Date
// lastMessageAt: Date
// totalConversations: Number default 0
// timestamps: true
// Add compound unique index on { businessId: 1, phone: 1 }.
// Add index on { resellerId: 1, lastMessageAt: -1 }.
const mongoose = require('mongoose')
const { Schema } = mongoose

const contactSchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', required: true },
  phone:      { type: String, required: true },
  name:       { type: String, default: null },
  profile: {
    studentName: { type: String },
    interestedClass: { type: String },
    altPhone: { type: String },
    email: { type: String }
  },
  tags: { type: [String], default: [] },
  optedIn: { type: Boolean, default: true },
  firstContactAt: { type: Date },
  lastMessageAt: { type: Date },
  totalConversations: { type: Number, default: 0 }
}, { timestamps: true })

contactSchema.index({ businessId: 1, phone: 1 }, { unique: true })
contactSchema.index({ resellerId: 1, lastMessageAt: -1 })

module.exports = mongoose.model('Contact', contactSchema)