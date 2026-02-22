// Mongoose schema for 'messages' collection.
// Fields exactly:
// conversationId: ObjectId ref 'Conversation' required
// businessId: ObjectId ref 'Business' required
// contactId: ObjectId ref 'Contact' required
// direction: String enum ['inbound','outbound'] required
// role: String enum ['user','assistant'] required
// content: { type: String default 'text', text: String } required
// waMessageId: String
// status: String enum ['sent','delivered','read','failed'] default 'sent'
// timestamp: Date default Date.now
// timestamps: true
// Add indexes: { conversationId:1, timestamp:1 }, { businessId:1, createdAt:-1 }, { waMessageId:1 } unique sparse on waMessageId.
const mongoose = require('mongoose')
const { Schema } = mongoose

const messageSchema = new Schema({
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  contactId: { type: Schema.Types.ObjectId, ref: 'Contact', required: true },
  direction: { type: String, enum: ['inbound','outbound'], required: true },
  role: { type: String, enum: ['user','assistant'], required: true },
  content: {
  contentType: { type: String, default: 'text' },
  text:        { type: String }
},
  waMessageId: { type: String },
  status: { type: String, enum: ['sent','delivered','read','failed'], default: 'sent' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true })

messageSchema.index({ conversationId: 1, timestamp: 1 })
messageSchema.index({ businessId: 1, createdAt: -1 })
messageSchema.index({ waMessageId: 1 }, { unique: true, sparse: true })

module.exports = mongoose.model('Message', messageSchema)
