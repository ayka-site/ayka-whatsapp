// Mongoose schema for 'knowledge_bases' collection.
// Fields exactly:
// businessId: ObjectId ref 'Business' required unique
// resellerId: ObjectId ref 'Reseller' required
// vertical: String required
// content: Mixed type (flexible JSON object, no fixed structure)
// version: Number default 1
// isActive: Boolean default true
// timestamps: true
// Add unique index on { businessId: 1 }.
const mongoose = require('mongoose')
const { Schema } = mongoose

const knowledgeBaseSchema = new Schema({
  businessId: { type: Schema.Types.ObjectId, ref: 'Business', required: true},
  resellerId: { type: Schema.Types.ObjectId, ref: 'Reseller', required: true },
  vertical: { type: String, required: true },
  content: { type: Schema.Types.Mixed },
  version: { type: Number, default: 1 },
  isActive: { type: Boolean, default: true }
}, { timestamps: true })

knowledgeBaseSchema.index({ businessId: 1 }, { unique: true })

module.exports = mongoose.model('KnowledgeBase', knowledgeBaseSchema)