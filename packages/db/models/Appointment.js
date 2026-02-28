/**
 * Appointment model — stores confirmed visit bookings made by the bot.
 *
 * Created when:
 *   1. Priya collects a preferredVisitTime from the parent
 *   2. LLM confirms the visit (VISIT_CONFIRMED: YES signal)
 *   3. scheduling.engine.js persists the record + notifies staff
 *
 * Lifecycle:
 *   confirmed → completed  (parent showed up)
 *   confirmed → no_show    (parent didn't come)
 *   confirmed → cancelled  (parent or staff cancelled)
 *
 * One conversation can have at most one active appointment (rescheduling
 * cancels the previous one and creates a new record).
 */
const mongoose = require('mongoose')
const { Schema } = mongoose

const appointmentSchema = new Schema({
  businessId:     { type: Schema.Types.ObjectId, ref: 'Business', required: true },
  resellerId:     { type: Schema.Types.ObjectId, ref: 'Reseller', required: true },
  conversationId: { type: Schema.Types.ObjectId, ref: 'Conversation', required: true },
  contactId:      { type: Schema.Types.ObjectId, ref: 'Contact', required: true },

  // Parent / student details snapshot (denormalized for staff notification readability)
  phone:           { type: String, required: true },
  parentName:      { type: String, default: null },
  studentName:     { type: String, default: null },
  interestedClass: { type: String, default: null },

  // Scheduling details — stored as strings because the bot collects
  // natural language ("Tuesday morning", "kal 10 baje"), not structured dates
  scheduledDate:  { type: String, default: null },  // "Tuesday", "tomorrow", "kal"
  scheduledTime:  { type: String, default: null },  // "morning", "10 AM", "dopahar"
  rawPreference:  { type: String, default: null },  // original user text: "Tuesday morning 10 baje"

  // Lifecycle
  status: {
    type: String,
    enum: ['confirmed', 'cancelled', 'completed', 'no_show'],
    default: 'confirmed',
  },

  // Staff notification tracking
  staffNotified:   { type: Boolean, default: false },
  staffNotifiedAt: { type: Date, default: null },

  // Documents the parent was told to bring (from vertical config)
  documentsAdvised: { type: [String], default: [] },
}, { timestamps: true })

// Index: find appointments for a business by date (dashboard view)
appointmentSchema.index({ businessId: 1, status: 1, createdAt: -1 })
// Index: find appointment for a specific conversation (pipeline lookup)
appointmentSchema.index({ conversationId: 1 }, { unique: true })

module.exports = mongoose.model('Appointment', appointmentSchema)
