const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const { authenticateJWT, requireRole, enforceBusinessScope } = require('../middleware/auth')
const asyncHandler = require('../utils/asyncHandler')
const { Conversation, Contact, Message, Appointment, KnowledgeBase, Business } = require('@ayka/db')
const redis = require('../config/redis')

// All client routes require auth + client role + business scope
router.use(authenticateJWT, requireRole('client'), enforceBusinessScope)

const toObjectId = (id) => new mongoose.Types.ObjectId(id)

function parseMongoTarget(uri) {
  if (!uri) return { host: null, dbName: null }
  try {
    const normalized = uri.startsWith('mongodb://') || uri.startsWith('mongodb+srv://') ? uri : `mongodb://${uri}`
    const parsed = new URL(normalized)
    const dbName = parsed.pathname ? parsed.pathname.replace(/^\//, '') : null
    return {
      host: parsed.host || null,
      dbName: dbName || null,
    }
  } catch (_) {
    return { host: null, dbName: null }
  }
}

/**
 * flushKbCacheForBusiness - Remove Redis KB cache for a business.
 * @param {string} businessId - Business identifier string.
 * @returns {Promise<boolean>} True when flush command succeeds.
 */
async function flushKbCacheForBusiness(businessId) {
  await redis.del(`kb:${businessId}`)
  return true
}

// Helper: get date range from period string
function getDateRange(period) {
  const now = new Date()
  const start = new Date()
  switch (period) {
    case 'today':
      start.setHours(0, 0, 0, 0)
      break
    case 'week':
      start.setDate(now.getDate() - 7)
      break
    case '3months':
      start.setMonth(now.getMonth() - 3)
      break
    case 'month':
    default:
      start.setDate(1)
      start.setHours(0, 0, 0, 0)
      break
  }
  return { start, end: now }
}

function getPreviousPeriodRange(period) {
  const { start, end } = getDateRange(period)
  const duration = end.getTime() - start.getTime()
  return { start: new Date(start.getTime() - duration), end: start }
}

// GET /api/client/stats?period=month
router.get('/stats', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const period = req.query.period || 'month'
  const { start, end } = getDateRange(period)
  const prev = getPreviousPeriodRange(period)

  const [current, previous] = await Promise.all([
    Conversation.aggregate([
      { $match: { businessId, createdAt: { $gte: start, $lte: end } } },
      { $group: {
        _id: null,
        totalLeads: { $sum: 1 },
        hotLeads: { $sum: { $cond: [{ $eq: ['$leadScore', 'hot'] }, 1, 0] } },
        visitsConfirmed: { $sum: { $cond: [{ $eq: ['$flowState.visitConfirmed', true] }, 1, 0] } },
        handoffs: { $sum: { $cond: [{ $eq: ['$flowState.handoffTriggered', true] }, 1, 0] } },
      }},
    ]),
    Conversation.aggregate([
      { $match: { businessId, createdAt: { $gte: prev.start, $lte: prev.end } } },
      { $group: {
        _id: null,
        totalLeads: { $sum: 1 },
        hotLeads: { $sum: { $cond: [{ $eq: ['$leadScore', 'hot'] }, 1, 0] } },
        visitsConfirmed: { $sum: { $cond: [{ $eq: ['$flowState.visitConfirmed', true] }, 1, 0] } },
        handoffs: { $sum: { $cond: [{ $eq: ['$flowState.handoffTriggered', true] }, 1, 0] } },
      }},
    ]),
  ])

  const c = current[0] || { totalLeads: 0, hotLeads: 0, visitsConfirmed: 0, handoffs: 0 }
  const p = previous[0] || { totalLeads: 0, hotLeads: 0, visitsConfirmed: 0, handoffs: 0 }

  const delta = (curr, prev) => prev === 0 ? (curr > 0 ? 100 : 0) : Math.round(((curr - prev) / prev) * 100)

  res.json({
    totalLeads: { value: c.totalLeads, delta: delta(c.totalLeads, p.totalLeads) },
    hotLeads: { value: c.hotLeads, delta: delta(c.hotLeads, p.hotLeads) },
    visitsConfirmed: { value: c.visitsConfirmed, delta: delta(c.visitsConfirmed, p.visitsConfirmed) },
    handoffs: { value: c.handoffs, delta: delta(c.handoffs, p.handoffs) },
  })
}))

// GET /api/client/system/runtime-source
router.get('/system/runtime-source', asyncHandler(async (req, res) => {
  const envMongoUri = process.env.MONGODB_URI || ''
  const parsedMongo = parseMongoTarget(envMongoUri)
  const mongoConnection = mongoose.connection || {}

  const targetBusinessId = toObjectId(req.user.businessId)
  const [conversationCount, contactCount] = await Promise.all([
    Conversation.countDocuments({ businessId: targetBusinessId }),
    Contact.countDocuments({ businessId: targetBusinessId }),
  ])

  res.json({
    api: {
      nodeEnv: process.env.NODE_ENV || null,
      host: req.hostname,
      uptimeSec: Math.round(process.uptime()),
    },
    mongodb: {
      envTarget: parsedMongo,
      activeConnection: {
        host: mongoConnection.host || null,
        port: mongoConnection.port || null,
        dbName: mongoConnection.name || mongoConnection.db?.databaseName || null,
      },
      yourBusinessCounts: {
        conversations: conversationCount,
        contacts: contactCount,
      },
    },
    redis: {
      envUrl: process.env.REDIS_URL || null,
      hasPassword: Boolean(process.env.REDIS_PASSWORD),
    },
  })
}))

// GET /api/client/charts/lead-volume?days=30
router.get('/charts/lead-volume', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const days = parseInt(req.query.days) || 30
  const start = new Date()
  start.setDate(start.getDate() - days)
  const prevStart = new Date(start)
  prevStart.setDate(prevStart.getDate() - days)

  const [current, previous] = await Promise.all([
    Conversation.aggregate([
      { $match: { businessId, createdAt: { $gte: start } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),
    Conversation.aggregate([
      { $match: { businessId, createdAt: { $gte: prevStart, $lt: start } } },
      { $group: {
        _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } },
        count: { $sum: 1 },
      }},
      { $sort: { _id: 1 } },
    ]),
  ])

  res.json({ current, previous })
}))

// GET /api/client/charts/score-distribution?period=month
router.get('/charts/score-distribution', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const { start, end } = getDateRange(req.query.period || 'month')

  const data = await Conversation.aggregate([
    { $match: { businessId, createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: '$leadScore', count: { $sum: 1 } } },
  ])

  const result = { hot: 0, warm: 0, cold: 0 }
  data.forEach(d => { if (result.hasOwnProperty(d._id)) result[d._id] = d.count })
  res.json(result)
}))

// GET /api/client/charts/funnel?period=month
router.get('/charts/funnel', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const { start, end } = getDateRange(req.query.period || 'month')

  const data = await Conversation.aggregate([
    { $match: { businessId, createdAt: { $gte: start, $lte: end } } },
    { $group: {
      _id: null,
      totalConversations: { $sum: 1 },
      dataCollected: { $sum: { $cond: [{ $in: ['$leadScore', ['warm', 'hot']] }, 1, 0] } },
      visitConfirmed: { $sum: { $cond: [{ $eq: ['$flowState.visitConfirmed', true] }, 1, 0] } },
      handoffTriggered: { $sum: { $cond: [{ $eq: ['$flowState.handoffTriggered', true] }, 1, 0] } },
    }},
  ])

  const d = data[0] || { totalConversations: 0, dataCollected: 0, visitConfirmed: 0, handoffTriggered: 0 }
  res.json(d)
}))

// GET /api/client/charts/score-over-time?days=30
router.get('/charts/score-over-time', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const days = parseInt(req.query.days) || 30
  const start = new Date()
  start.setDate(start.getDate() - days)

  const data = await Conversation.aggregate([
    { $match: { businessId, createdAt: { $gte: start } } },
    { $group: {
      _id: {
        date: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } },
        score: '$leadScore',
      },
      count: { $sum: 1 },
    }},
    { $sort: { '_id.date': 1 } },
  ])

  res.json(data)
}))

// GET /api/client/charts/heatmap?days=30
router.get('/charts/heatmap', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const days = parseInt(req.query.days) || 30
  const start = new Date()
  start.setDate(start.getDate() - days)

  const data = await Message.aggregate([
    { $match: { businessId, direction: 'inbound', createdAt: { $gte: start } } },
    { $group: {
      _id: {
        dayOfWeek: { $dayOfWeek: { date: '$timestamp', timezone: 'Asia/Kolkata' } },
        hour: { $hour: { date: '$timestamp', timezone: 'Asia/Kolkata' } },
      },
      count: { $sum: 1 },
    }},
  ])

  res.json(data)
}))

// GET /api/client/activity?limit=15
router.get('/activity', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const limit = parseInt(req.query.limit) || 15

  // Get recent conversations with score changes, visits, handoffs
  const recentConvos = await Conversation.find({ businessId })
    .sort({ updatedAt: -1 })
    .limit(limit)
    .populate('contactId', 'name phone')
    .lean()

  const activities = []
  for (const c of recentConvos) {
    const name = c.contactId?.name || c.phone
    if (c.flowState?.handoffTriggered) {
      activities.push({ type: 'handoff', description: `${name} — handoff triggered`, timestamp: c.flowState.handoffAt || c.updatedAt, conversationId: c._id })
    }
    if (c.flowState?.visitConfirmed) {
      activities.push({ type: 'visit_confirmed', description: `${name} — visit confirmed`, timestamp: c.flowState.visitConfirmedAt || c.updatedAt, conversationId: c._id })
    }
    if (c.leadScore === 'hot') {
      activities.push({ type: 'score_upgraded', description: `${name} upgraded to Hot`, timestamp: c.leadScoreUpdatedAt || c.updatedAt, conversationId: c._id })
    }
    if (c.leadScore === 'warm' && !c.flowState?.handoffTriggered) {
      activities.push({ type: 'score_upgraded', description: `${name} upgraded to Warm`, timestamp: c.leadScoreUpdatedAt || c.updatedAt, conversationId: c._id })
    }
    // Always add as new_lead for recently created
    if (Date.now() - new Date(c.createdAt).getTime() < 86400000 * 7) {
      activities.push({ type: 'new_lead', description: `New lead: ${name}`, timestamp: c.createdAt, conversationId: c._id })
    }
  }

  // Sort by timestamp descending, take top N
  activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  res.json(activities.slice(0, limit))
}))

// GET /api/client/leads
router.get('/leads', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 25
  const skip = (page - 1) * limit

  const filter = { businessId }

  // Score filter
  if (req.query.score) {
    const scores = req.query.score.split(',')
    filter.leadScore = { $in: scores }
  }

  // Date range
  if (req.query.from || req.query.to) {
    filter.createdAt = {}
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from)
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to)
  }

  // Source filter
  if (req.query.source) {
    filter['source.sourceType'] = req.query.source
  }

  // Class filter
  if (req.query.class) {
    filter['flowState.collectedData.interestedClass'] = req.query.class
  }

  // Search by name or phone
  if (req.query.search) {
    const s = req.query.search.trim()
    filter.$or = [
      { phone: { $regex: s, $options: 'i' } },
      { 'flowState.collectedData.parentName': { $regex: s, $options: 'i' } },
      { 'flowState.collectedData.studentName': { $regex: s, $options: 'i' } },
    ]
  }

  const [leads, total, messageCounts] = await Promise.all([
    Conversation.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('contactId', 'name phone profile')
      .lean(),
    Conversation.countDocuments(filter),
    // Get message counts for these conversations
    Message.aggregate([
      { $match: { businessId } },
      { $group: { _id: '$conversationId', count: { $sum: 1 }, lastMessage: { $max: '$timestamp' } } },
    ]),
  ])

  const msgMap = {}
  messageCounts.forEach(m => { msgMap[m._id.toString()] = { count: m.count, lastMessage: m.lastMessage } })

  const results = leads.map(l => ({
    _id: l._id,
    parentName: l.flowState?.collectedData?.parentName || l.contactId?.name || null,
    phone: l.phone,
    studentName: l.flowState?.collectedData?.studentName || l.contactId?.profile?.studentName || null,
    interestedClass: l.flowState?.collectedData?.interestedClass || null,
    leadScore: l.leadScore,
    leadScoreReason: l.leadScoreReason,
    source: l.source?.sourceType || 'direct',
    visitConfirmed: l.flowState?.visitConfirmed || false,
    visitConfirmedAt: l.flowState?.visitConfirmedAt || null,
    handoffTriggered: l.flowState?.handoffTriggered || false,
    messageCount: msgMap[l._id.toString()]?.count || 0,
    lastMessage: msgMap[l._id.toString()]?.lastMessage || l.updatedAt,
    createdAt: l.createdAt,
  }))

  // Get unique sources and classes for filter options
  const [sources, classes] = await Promise.all([
    Conversation.distinct('source.sourceType', { businessId }),
    Conversation.distinct('flowState.collectedData.interestedClass', { businessId }),
  ])

  res.json({
    leads: results,
    total,
    page,
    totalPages: Math.ceil(total / limit),
    filters: { sources: sources.filter(Boolean), classes: classes.filter(Boolean) },
  })
}))

// GET /api/client/leads/:conversationId
router.get('/leads/:conversationId', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const conversation = await Conversation.findOne({
    _id: req.params.conversationId,
    businessId,
  }).populate('contactId').lean()

  if (!conversation) {
    return res.status(404).json({ error: 'Lead not found' })
  }

  const [messageCount, appointment] = await Promise.all([
    Message.countDocuments({ conversationId: conversation._id }),
    Appointment.findOne({ conversationId: conversation._id }).lean(),
  ])

  res.json({
    ...conversation,
    messageCount,
    appointment,
  })
}))

// GET /api/client/conversations
router.get('/conversations', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 50
  const skip = (page - 1) * limit

  const filter = { businessId }
  if (req.query.score) filter.leadScore = { $in: req.query.score.split(',') }
  if (req.query.search) {
    const s = req.query.search.trim()
    filter.$or = [
      { phone: { $regex: s, $options: 'i' } },
      { 'flowState.collectedData.parentName': { $regex: s, $options: 'i' } },
    ]
  }

  const [conversations, total] = await Promise.all([
    Conversation.find(filter)
      .sort({ updatedAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('contactId', 'name phone profile')
      .lean(),
    Conversation.countDocuments(filter),
  ])

  // Get last message for each conversation
  const convoIds = conversations.map(c => c._id)
  const lastMessages = await Message.aggregate([
    { $match: { conversationId: { $in: convoIds } } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: '$conversationId', lastMsg: { $first: '$content.text' }, lastTime: { $first: '$timestamp' } } },
  ])

  const lastMsgMap = {}
  lastMessages.forEach(m => { lastMsgMap[m._id.toString()] = { text: m.lastMsg, time: m.lastTime } })

  const results = conversations.map(c => ({
    _id: c._id,
    parentName: c.flowState?.collectedData?.parentName || c.contactId?.name || null,
    phone: c.phone,
    studentName: c.flowState?.collectedData?.studentName || null,
    interestedClass: c.flowState?.collectedData?.interestedClass || null,
    leadScore: c.leadScore,
    status: c.status,
    lastMessage: lastMsgMap[c._id.toString()]?.text || null,
    lastMessageAt: lastMsgMap[c._id.toString()]?.time || c.updatedAt,
  }))

  res.json({ conversations: results, total, page, totalPages: Math.ceil(total / limit) })
}))

// GET /api/client/conversations/:conversationId/messages
router.get('/conversations/:conversationId/messages', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const limit = parseInt(req.query.limit) || 50

  // Verify conversation belongs to this business
  const convo = await Conversation.findOne({
    _id: req.params.conversationId,
    businessId,
  }).lean()

  if (!convo) {
    return res.status(404).json({ error: 'Conversation not found' })
  }

  const filter = { conversationId: convo._id, businessId }

  // Cursor-based pagination
  if (req.query.before) {
    filter.timestamp = { $lt: new Date(req.query.before) }
  }

  const messages = await Message.find(filter)
    .sort({ timestamp: -1 })
    .limit(limit + 1)
    .lean()

  const hasMore = messages.length > limit
  const result = hasMore ? messages.slice(0, limit) : messages

  res.json({
    messages: result.reverse(), // Return in chronological order
    hasMore,
    conversation: convo,
  })
}))

// GET /api/client/appointments
router.get('/appointments', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 25
  const skip = (page - 1) * limit

  const filter = { businessId }
  if (req.query.status) filter.status = req.query.status

  const [appointments, total] = await Promise.all([
    Appointment.find(filter)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .lean(),
    Appointment.countDocuments(filter),
  ])

  res.json({ appointments, total, page, totalPages: Math.ceil(total / limit) })
}))

// GET /api/client/settings
router.get('/settings', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)

  const [business, kb] = await Promise.all([
    Business.findById(businessId).lean(),
    KnowledgeBase.findOne({ businessId }).lean(),
  ])

  res.json({
    school: {
      name: kb?.content?.about?.name || business?.name,
      address: kb?.content?.about?.address || null,
      board: kb?.content?.about?.board || null,
      affiliationNo: kb?.content?.about?.affiliationNo || null,
      contact: kb?.content?.handoff?.staffPhone || business?.settings?.handoffPhone || null,
      email: kb?.content?.about?.email || null,
      website: kb?.content?.about?.website || null,
      principal: kb?.content?.principal?.name || null,
      classes: kb?.content?.academics?.classesOffered || null,
      medium: kb?.content?.academics?.medium || null,
      facilities: kb?.content?.campus?.facilities || null,
      timings: kb?.content?.timing?.schoolHours || kb?.content?.handoff?.workingHours || '9 AM – 4 PM, Mon–Sat',
      tagline: kb?.content?.about?.tagline || kb?.content?.about?.vision || null,
    },
    bot: {
      _id: business?._id,
      name: business?.name,
      vertical: business?.vertical,
      isActive: business?.isActive ?? false,
      whatsappPhoneId: business?.whatsapp?.phoneNumberId || null,
      timezone: business?.settings?.timezone || 'Asia/Kolkata',
      createdAt: business?.createdAt,
      status: business?.isActive ? 'active' : 'paused',
      staffNotificationPhone: business?.settings?.handoffPhone || kb?.content?.handoff?.staffPhone || null,
      workingHours: kb?.content?.handoff?.workingHours || '9 AM – 4 PM, Mon–Sat',
      visitHours: kb?.content?.timing?.visitHours || '9 AM – 2 PM, Mon–Sat',
      documentsRequired: kb?.content?.admissions?.documentsRequired || [],
    },
  })
}))

// POST /api/client/flush-kb
router.post('/flush-kb', asyncHandler(async (req, res) => {
  const businessId = req.user.businessId
  await flushKbCacheForBusiness(businessId)
  res.json({ success: true, message: 'KB cache flushed' })
}))

// GET /api/client/export/leads (CSV stream)
router.get('/export/leads', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)

  const filter = { businessId }
  if (req.query.score) filter.leadScore = { $in: req.query.score.split(',') }
  if (req.query.from) filter.createdAt = { ...filter.createdAt, $gte: new Date(req.query.from) }
  if (req.query.to) filter.createdAt = { ...filter.createdAt, $lte: new Date(req.query.to) }

  res.setHeader('Content-Type', 'text/csv')
  res.setHeader('Content-Disposition', `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"`)

  // CSV header
  res.write('Parent Name,Phone,Student Name,Class,Score,Score Reason,Source,Visit Confirmed,Handoff,Created At\n')

  const cursor = Conversation.find(filter).sort({ createdAt: -1 }).cursor()

  for await (const doc of cursor) {
    const cd = doc.flowState?.collectedData || {}
    const row = [
      `"${(cd.parentName || '').replace(/"/g, '""')}"`,
      doc.phone,
      `"${(cd.studentName || '').replace(/"/g, '""')}"`,
      cd.interestedClass || '',
      doc.leadScore || 'cold',
      `"${(doc.leadScoreReason || '').replace(/"/g, '""')}"`,
      doc.source?.sourceType || 'direct',
      doc.flowState?.visitConfirmed ? 'Yes' : 'No',
      doc.flowState?.handoffTriggered ? 'Yes' : 'No',
      doc.createdAt?.toISOString() || '',
    ].join(',')
    res.write(row + '\n')
  }

  res.end()
}))

module.exports = router
