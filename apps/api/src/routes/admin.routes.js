const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const { authenticateJWT, requireRole, enforceResellerScope } = require('../middleware/auth')
const asyncHandler = require('../utils/asyncHandler')
const { Conversation, Contact, Message, Appointment, Business, KnowledgeBase, Reseller } = require('@ayka/db')
const redis = require('../config/redis')

router.use(authenticateJWT, requireRole('reseller'), enforceResellerScope)

const toObjectId = (id) => new mongoose.Types.ObjectId(id)

/**
 * flushKbCache - Delete Redis KB cache key for a business.
 * @param {string} businessId - Business ID to flush.
 * @returns {Promise<void>} Resolves after cache delete.
 */
async function flushKbCache(businessId) {
  await redis.del(`kb:${businessId}`)
}

function getDateRange(period) {
  const now = new Date()
  const start = new Date()
  switch (period) {
    case 'today': start.setHours(0, 0, 0, 0); break
    case 'week': start.setDate(now.getDate() - 7); break
    case '3months': start.setMonth(now.getMonth() - 3); break
    case 'month': default: start.setDate(1); start.setHours(0, 0, 0, 0); break
  }
  return { start, end: now }
}

function getPreviousPeriodRange(period) {
  const { start, end } = getDateRange(period)
  const duration = end.getTime() - start.getTime()
  return { start: new Date(start.getTime() - duration), end: start }
}

// GET /api/admin/stats
router.get('/stats', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const period = req.query.period || 'month'
  const { start, end } = getDateRange(period)
  const prev = getPreviousPeriodRange(period)

  const [clients, current, previous] = await Promise.all([
    Business.countDocuments({ resellerId, isActive: true }),
    Conversation.aggregate([
      { $match: { resellerId, createdAt: { $gte: start, $lte: end } } },
      { $group: {
        _id: null,
        totalLeads: { $sum: 1 },
        hotLeads: { $sum: { $cond: [{ $eq: ['$leadScore', 'hot'] }, 1, 0] } },
        visitsConfirmed: { $sum: { $cond: [{ $eq: ['$flowState.visitConfirmed', true] }, 1, 0] } },
        handoffs: { $sum: { $cond: [{ $eq: ['$flowState.handoffTriggered', true] }, 1, 0] } },
      }},
    ]),
    Conversation.aggregate([
      { $match: { resellerId, createdAt: { $gte: prev.start, $lte: prev.end } } },
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
    activeClients: { value: clients, delta: 0 },
    totalLeads: { value: c.totalLeads, delta: delta(c.totalLeads, p.totalLeads) },
    hotLeads: { value: c.hotLeads, delta: delta(c.hotLeads, p.hotLeads) },
    visitsConfirmed: { value: c.visitsConfirmed, delta: delta(c.visitsConfirmed, p.visitsConfirmed) },
    handoffs: { value: c.handoffs, delta: delta(c.handoffs, p.handoffs) },
    botUptime: { value: 99.9, delta: 0 },
  })
}))

// GET /api/admin/charts/leads-per-client
router.get('/charts/leads-per-client', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const { start, end } = getDateRange(req.query.period || 'month')

  const data = await Conversation.aggregate([
    { $match: { resellerId, createdAt: { $gte: start, $lte: end } } },
    { $group: {
      _id: { businessId: '$businessId', score: '$leadScore' },
      count: { $sum: 1 },
    }},
  ])

  // Get business names
  const businessIds = [...new Set(data.map(d => d._id.businessId.toString()))]
  const businesses = await Business.find({ _id: { $in: businessIds } }, { name: 1 }).lean()
  const nameMap = {}
  businesses.forEach(b => { nameMap[b._id.toString()] = b.name })

  // Group by business
  const result = {}
  data.forEach(d => {
    const bid = d._id.businessId.toString()
    if (!result[bid]) result[bid] = { name: nameMap[bid] || 'Unknown', hot: 0, warm: 0, cold: 0 }
    result[bid][d._id.score] = d.count
  })

  res.json(Object.values(result))
}))

// GET /api/admin/charts/portfolio-score
router.get('/charts/portfolio-score', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const { start, end } = getDateRange(req.query.period || 'month')

  const data = await Conversation.aggregate([
    { $match: { resellerId, createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: '$leadScore', count: { $sum: 1 } } },
  ])

  const result = { hot: 0, warm: 0, cold: 0 }
  data.forEach(d => { if (result.hasOwnProperty(d._id)) result[d._id] = d.count })
  res.json(result)
}))

// GET /api/admin/charts/platform-volume
router.get('/charts/platform-volume', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const days = parseInt(req.query.days) || 30
  const start = new Date()
  start.setDate(start.getDate() - days)
  const prevStart = new Date(start)
  prevStart.setDate(prevStart.getDate() - days)

  const [current, previous] = await Promise.all([
    Conversation.aggregate([
      { $match: { resellerId, createdAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Conversation.aggregate([
      { $match: { resellerId, createdAt: { $gte: prevStart, $lt: start } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ])

  res.json({ current, previous })
}))

// GET /api/admin/charts/top-clients
router.get('/charts/top-clients', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const { start, end } = getDateRange(req.query.period || 'month')

  const data = await Conversation.aggregate([
    { $match: { resellerId, leadScore: 'hot', createdAt: { $gte: start, $lte: end } } },
    { $group: { _id: '$businessId', hotCount: { $sum: 1 } } },
    { $sort: { hotCount: -1 } },
    { $limit: 10 },
  ])

  const businessIds = data.map(d => d._id)
  const businesses = await Business.find({ _id: { $in: businessIds } }, { name: 1 }).lean()
  const nameMap = {}
  businesses.forEach(b => { nameMap[b._id.toString()] = b.name })

  res.json(data.map(d => ({ name: nameMap[d._id.toString()] || 'Unknown', hotCount: d.hotCount })))
}))

// GET /api/admin/charts/monthly-growth
router.get('/charts/monthly-growth', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const months = parseInt(req.query.months) || 6
  const start = new Date()
  start.setMonth(start.getMonth() - months)

  const data = await Conversation.aggregate([
    { $match: { resellerId, createdAt: { $gte: start } } },
    { $group: {
      _id: {
        month: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } },
        businessId: '$businessId',
      },
      count: { $sum: 1 },
    }},
    { $sort: { '_id.month': 1 } },
  ])

  const businessIds = [...new Set(data.map(d => d._id.businessId.toString()))]
  const businesses = await Business.find({ _id: { $in: businessIds } }, { name: 1 }).lean()
  const nameMap = {}
  businesses.forEach(b => { nameMap[b._id.toString()] = b.name })

  res.json({ data, businesses: nameMap })
}))

// GET /api/admin/charts/conversion-funnel
router.get('/charts/conversion-funnel', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const { start, end } = getDateRange(req.query.period || 'month')

  const data = await Conversation.aggregate([
    { $match: { resellerId, createdAt: { $gte: start, $lte: end } } },
    { $group: {
      _id: '$businessId',
      total: { $sum: 1 },
      dataCollected: { $sum: { $cond: [{ $in: ['$leadScore', ['warm', 'hot']] }, 1, 0] } },
      visitConfirmed: { $sum: { $cond: [{ $eq: ['$flowState.visitConfirmed', true] }, 1, 0] } },
      handoff: { $sum: { $cond: [{ $eq: ['$flowState.handoffTriggered', true] }, 1, 0] } },
    }},
  ])

  const businessIds = data.map(d => d._id)
  const businesses = await Business.find({ _id: { $in: businessIds } }, { name: 1 }).lean()
  const nameMap = {}
  businesses.forEach(b => { nameMap[b._id.toString()] = b.name })

  res.json(data.map(d => ({ name: nameMap[d._id.toString()] || 'Unknown', ...d, _id: undefined })))
}))

// GET /api/admin/charts/message-by-day
router.get('/charts/message-by-day', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const days = parseInt(req.query.days) || 30
  const start = new Date()
  start.setDate(start.getDate() - days)

  // Get businessIds for this reseller
  const businesses = await Business.find({ resellerId }, { _id: 1 }).lean()
  const businessIds = businesses.map(b => b._id)

  const data = await Message.aggregate([
    { $match: { businessId: { $in: businessIds }, direction: 'inbound', createdAt: { $gte: start } } },
    { $group: {
      _id: { $dayOfWeek: { date: '$timestamp', timezone: 'Asia/Kolkata' } },
      count: { $sum: 1 },
    }},
    { $sort: { _id: 1 } },
  ])

  const dayNames = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
  res.json(data.map(d => ({ day: dayNames[d._id - 1], count: d.count })))
}))

// GET /api/admin/clients
router.get('/clients', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)

  const clients = await Business.find({ resellerId }).lean()

  // Get lead counts per client
  const businessIds = clients.map(c => c._id)
  const { start } = getDateRange('month')

  const leadCounts = await Conversation.aggregate([
    { $match: { businessId: { $in: businessIds }, createdAt: { $gte: start } } },
    { $group: {
      _id: { businessId: '$businessId', score: '$leadScore' },
      count: { $sum: 1 },
    }},
  ])

  const lastActivity = await Conversation.aggregate([
    { $match: { businessId: { $in: businessIds } } },
    { $group: { _id: '$businessId', lastActivity: { $max: '$updatedAt' } } },
  ])

  const countMap = {}
  leadCounts.forEach(l => {
    const bid = l._id.businessId.toString()
    if (!countMap[bid]) countMap[bid] = { total: 0, hot: 0, warm: 0, cold: 0 }
    countMap[bid][l._id.score] = l.count
    countMap[bid].total += l.count
  })

  const activityMap = {}
  lastActivity.forEach(a => { activityMap[a._id.toString()] = a.lastActivity })

  res.json(clients.map(c => ({
    _id: c._id,
    name: c.name,
    vertical: c.vertical,
    isActive: c.isActive,
    subscription: c.subscription,
    leads: countMap[c._id.toString()] || { total: 0, hot: 0, warm: 0, cold: 0 },
    lastActivity: activityMap[c._id.toString()] || c.updatedAt,
  })))
}))

// GET /api/admin/clients/:businessId/stats
router.get('/clients/:businessId/stats', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const businessId = toObjectId(req.params.businessId)

  // Verify business belongs to this reseller
  const business = await Business.findOne({ _id: businessId, resellerId }).lean()
  if (!business) return res.status(404).json({ error: 'Client not found' })

  const { start, end } = getDateRange('month')
  const stats = await Conversation.aggregate([
    { $match: { businessId, createdAt: { $gte: start, $lte: end } } },
    { $group: {
      _id: null,
      totalLeads: { $sum: 1 },
      hotLeads: { $sum: { $cond: [{ $eq: ['$leadScore', 'hot'] }, 1, 0] } },
      visitsConfirmed: { $sum: { $cond: [{ $eq: ['$flowState.visitConfirmed', true] }, 1, 0] } },
      handoffs: { $sum: { $cond: [{ $eq: ['$flowState.handoffTriggered', true] }, 1, 0] } },
    }},
  ])

  res.json({ business, stats: stats[0] || { totalLeads: 0, hotLeads: 0, visitsConfirmed: 0, handoffs: 0 } })
}))

// GET /api/admin/leads
router.get('/leads', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 25
  const skip = (page - 1) * limit

  const filter = { resellerId }
  if (req.query.businessId) filter.businessId = toObjectId(req.query.businessId)
  if (req.query.score) filter.leadScore = { $in: req.query.score.split(',') }
  if (req.query.from || req.query.to) {
    filter.createdAt = {}
    if (req.query.from) filter.createdAt.$gte = new Date(req.query.from)
    if (req.query.to) filter.createdAt.$lte = new Date(req.query.to)
  }
  if (req.query.search) {
    const s = req.query.search.trim()
    filter.$or = [
      { phone: { $regex: s, $options: 'i' } },
      { 'flowState.collectedData.parentName': { $regex: s, $options: 'i' } },
    ]
  }

  const [leads, total] = await Promise.all([
    Conversation.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).populate('contactId', 'name phone').lean(),
    Conversation.countDocuments(filter),
  ])

  // Get business names
  const businessIds = [...new Set(leads.map(l => l.businessId.toString()))]
  const businesses = await Business.find({ _id: { $in: businessIds } }, { name: 1 }).lean()
  const nameMap = {}
  businesses.forEach(b => { nameMap[b._id.toString()] = b.name })

  const results = leads.map(l => ({
    _id: l._id,
    parentName: l.flowState?.collectedData?.parentName || l.contactId?.name || null,
    phone: l.phone,
    studentName: l.flowState?.collectedData?.studentName || null,
    interestedClass: l.flowState?.collectedData?.interestedClass || null,
    leadScore: l.leadScore,
    leadScoreReason: l.leadScoreReason,
    source: l.source?.sourceType || 'direct',
    visitConfirmed: l.flowState?.visitConfirmed || false,
    handoffTriggered: l.flowState?.handoffTriggered || false,
    businessName: nameMap[l.businessId.toString()] || 'Unknown',
    createdAt: l.createdAt,
  }))

  res.json({ leads: results, total, page, totalPages: Math.ceil(total / limit) })
}))

// GET /api/admin/conversations
router.get('/conversations', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 50
  const skip = (page - 1) * limit

  const filter = { resellerId }
  if (req.query.businessId) filter.businessId = toObjectId(req.query.businessId)
  if (req.query.score) filter.leadScore = { $in: req.query.score.split(',') }
  if (req.query.search) {
    const s = req.query.search.trim()
    filter.$or = [
      { phone: { $regex: s, $options: 'i' } },
      { 'flowState.collectedData.parentName': { $regex: s, $options: 'i' } },
    ]
  }

  const [conversations, total] = await Promise.all([
    Conversation.find(filter).sort({ updatedAt: -1 }).skip(skip).limit(limit).populate('contactId', 'name phone').lean(),
    Conversation.countDocuments(filter),
  ])

  const convoIds = conversations.map(c => c._id)
  const lastMessages = await Message.aggregate([
    { $match: { conversationId: { $in: convoIds } } },
    { $sort: { timestamp: -1 } },
    { $group: { _id: '$conversationId', lastMsg: { $first: '$content.text' }, lastTime: { $first: '$timestamp' } } },
  ])

  const lastMsgMap = {}
  lastMessages.forEach(m => { lastMsgMap[m._id.toString()] = { text: m.lastMsg, time: m.lastTime } })

  // Get business names
  const businessIds = [...new Set(conversations.map(c => c.businessId.toString()))]
  const businesses = await Business.find({ _id: { $in: businessIds } }, { name: 1 }).lean()
  const nameMap = {}
  businesses.forEach(b => { nameMap[b._id.toString()] = b.name })

  const results = conversations.map(c => ({
    _id: c._id,
    parentName: c.flowState?.collectedData?.parentName || c.contactId?.name || null,
    phone: c.phone,
    leadScore: c.leadScore,
    status: c.status,
    businessName: nameMap[c.businessId.toString()] || 'Unknown',
    lastMessage: lastMsgMap[c._id.toString()]?.text || null,
    lastMessageAt: lastMsgMap[c._id.toString()]?.time || c.updatedAt,
  }))

  res.json({ conversations: results, total, page, totalPages: Math.ceil(total / limit) })
}))

// GET /api/admin/conversations/:conversationId/messages
router.get('/conversations/:conversationId/messages', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const limit = parseInt(req.query.limit) || 50

  const convo = await Conversation.findOne({ _id: req.params.conversationId, resellerId }).lean()
  if (!convo) return res.status(404).json({ error: 'Conversation not found' })

  const filter = { conversationId: convo._id }
  if (req.query.before) filter.timestamp = { $lt: new Date(req.query.before) }

  const messages = await Message.find(filter).sort({ timestamp: -1 }).limit(limit + 1).lean()
  const hasMore = messages.length > limit
  const result = hasMore ? messages.slice(0, limit) : messages

  res.json({ messages: result.reverse(), hasMore, conversation: convo })
}))

// GET /api/admin/appointments
router.get('/appointments', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 25
  const skip = (page - 1) * limit

  const filter = { resellerId }
  if (req.query.businessId) filter.businessId = toObjectId(req.query.businessId)
  if (req.query.status) filter.status = req.query.status

  const [appointments, total] = await Promise.all([
    Appointment.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Appointment.countDocuments(filter),
  ])

  res.json({ appointments, total, page, totalPages: Math.ceil(total / limit) })
}))

// GET /api/admin/activity
router.get('/activity', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const limit = parseInt(req.query.limit) || 15

  const recentConvos = await Conversation.find({ resellerId })
    .sort({ updatedAt: -1 })
    .limit(limit * 2)
    .populate('contactId', 'name phone')
    .lean()

  const businessIds = [...new Set(recentConvos.map(c => c.businessId.toString()))]
  const businesses = await Business.find({ _id: { $in: businessIds } }, { name: 1 }).lean()
  const nameMap = {}
  businesses.forEach(b => { nameMap[b._id.toString()] = b.name })

  const activities = []
  for (const c of recentConvos) {
    const name = c.contactId?.name || c.phone
    const clientName = nameMap[c.businessId.toString()] || 'Unknown'
    if (c.leadScore === 'hot') {
      activities.push({ type: 'score_upgraded', description: `${name} upgraded to Hot (${clientName})`, timestamp: c.leadScoreUpdatedAt || c.updatedAt })
    }
    if (c.flowState?.visitConfirmed) {
      activities.push({ type: 'visit_confirmed', description: `${name} — visit confirmed (${clientName})`, timestamp: c.flowState.visitConfirmedAt || c.updatedAt })
    }
    if (c.flowState?.handoffTriggered) {
      activities.push({ type: 'handoff', description: `${name} — handoff (${clientName})`, timestamp: c.flowState.handoffAt || c.updatedAt })
    }
  }

  activities.sort((a, b) => new Date(b.timestamp) - new Date(a.timestamp))
  res.json(activities.slice(0, limit))
}))

// GET /api/admin/analytics/score-trend
router.get('/analytics/score-trend', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const months = parseInt(req.query.months) || 6
  const start = new Date()
  start.setMonth(start.getMonth() - months)

  const data = await Conversation.aggregate([
    { $match: { resellerId, createdAt: { $gte: start } } },
    { $group: {
      _id: {
        month: { $dateToString: { format: '%Y-%m', date: '$createdAt', timezone: 'Asia/Kolkata' } },
        score: '$leadScore',
      },
      count: { $sum: 1 },
    }},
    { $sort: { '_id.month': 1 } },
  ])

  res.json(data)
}))

// GET /api/admin/analytics/avg-score-time
router.get('/analytics/avg-score-time', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)

  // Average messages to reach Hot, per client
  const businesses = await Business.find({ resellerId }, { _id: 1, name: 1 }).lean()

  const results = []
  for (const biz of businesses) {
    const hotConvos = await Conversation.find({ businessId: biz._id, leadScore: 'hot' }, { _id: 1 }).lean()
    if (hotConvos.length === 0) {
      results.push({ name: biz.name, avgMessages: null })
      continue
    }

    const convoIds = hotConvos.map(c => c._id)
    const msgCounts = await Message.aggregate([
      { $match: { conversationId: { $in: convoIds } } },
      { $group: { _id: '$conversationId', count: { $sum: 1 } } },
    ])

    const avg = msgCounts.length > 0
      ? Math.round(msgCounts.reduce((s, m) => s + m.count, 0) / msgCounts.length)
      : null

    results.push({ name: biz.name, avgMessages: avg })
  }

  res.json(results)
}))

// GET /api/admin/settings
router.get('/settings', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const reseller = await Reseller.findById(resellerId).lean()
  if (!reseller) return res.status(404).json({ error: 'Reseller not found' })

  res.json({
    name: reseller.name,
    slug: reseller.slug,
    email: reseller.email,
    phone: reseller.phone,
    plan: reseller.plan,
    pricing: reseller.pricing,
    platformFeeStatus: reseller.platformFeeStatus,
    themeConfig: reseller.themeConfig,
    isActive: reseller.isActive,
  })
}))

// ─── CLIENT MANAGEMENT ──────────────────────────────────────────

// PATCH /api/admin/clients/:businessId — Update client settings (reseller can edit their own clients)
router.patch('/clients/:businessId', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const businessId = toObjectId(req.params.businessId)

  const business = await Business.findOne({ _id: businessId, resellerId })
  if (!business) return res.status(404).json({ error: 'Client not found or not in your portfolio' })

  // Resellers can only edit safe fields
  const allowed = ['name', 'settings', 'isActive', 'subscription']
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) {
      if (key === 'settings') {
        // Merge settings instead of overwriting
        updates.settings = { ...business.settings?.toObject?.() || business.settings || {}, ...req.body.settings }
      } else {
        updates[key] = req.body[key]
      }
    }
  }

  const updated = await Business.findByIdAndUpdate(businessId, { $set: updates }, { new: true, runValidators: true })
  res.json(updated)
}))

// PATCH /api/admin/clients/:businessId/bot — Pause or resume a client bot
router.patch('/clients/:businessId/bot', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const businessId = toObjectId(req.params.businessId)

  const business = await Business.findOne({ _id: businessId, resellerId })
  if (!business) return res.status(404).json({ error: 'Client not found or not in your portfolio' })

  const { isActive } = req.body
  if (typeof isActive !== 'boolean') return res.status(400).json({ error: 'isActive must be a boolean' })

  const updated = await Business.findByIdAndUpdate(businessId, { $set: { isActive } }, { new: true })
  res.json({ message: isActive ? 'Bot resumed' : 'Bot paused', client: updated })
}))

// POST /api/admin/flush-kb/:businessId
router.post('/flush-kb/:businessId', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const businessId = toObjectId(req.params.businessId)
  const business = await Business.findOne({ _id: businessId, resellerId }, { _id: 1 }).lean()
  if (!business) return res.status(404).json({ error: 'Client not found or not in your portfolio' })

  await flushKbCache(req.params.businessId)
  res.json({ success: true, message: 'KB cache flushed', businessId: req.params.businessId })
}))

// ─── WIDGET CONFIGURATION ───────────────────────────────────────

// GET /api/admin/clients/:businessId/widget — Get widget config for a client
router.get('/clients/:businessId/widget', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const businessId = toObjectId(req.params.businessId)

  const business = await Business.findOne({ _id: businessId, resellerId }, {
    name: 1, widget: 1, settings: 1,
  }).lean()
  if (!business) return res.status(404).json({ error: 'Client not found' })

  res.json(business)
}))

// PATCH /api/admin/clients/:businessId/widget — Update widget config
router.patch('/clients/:businessId/widget', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)
  const businessId = toObjectId(req.params.businessId)

  const business = await Business.findOne({ _id: businessId, resellerId })
  if (!business) return res.status(404).json({ error: 'Client not found or not in your portfolio' })

  const { widget } = req.body
  if (!widget) return res.status(400).json({ error: 'widget object required' })

  const updated = await Business.findByIdAndUpdate(businessId, {
    $set: { widget },
  }, { new: true, runValidators: true })

  res.json(updated)
}))

// ─── RESELLER SELF-SETTINGS ─────────────────────────────────────

// PATCH /api/admin/settings — Update own profile and theme config
router.patch('/settings', asyncHandler(async (req, res) => {
  const resellerId = toObjectId(req.user.resellerId)

  // Resellers can update their own profile fields and theme
  const allowed = ['name', 'email', 'phone', 'themeConfig']
  const updates = {}
  for (const key of allowed) {
    if (req.body[key] !== undefined) updates[key] = req.body[key]
  }

  const reseller = await Reseller.findByIdAndUpdate(resellerId, { $set: updates }, { new: true, runValidators: true })
  if (!reseller) return res.status(404).json({ error: 'Reseller not found' })

  res.json(reseller)
}))

module.exports = router
