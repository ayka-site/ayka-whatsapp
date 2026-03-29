const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const { authenticateJWT, requireRole } = require('../middleware/auth')
const asyncHandler = require('../utils/asyncHandler')
const { encrypt } = require('../utils/encryption')
const { Conversation, Contact, Message, Appointment, Business, KnowledgeBase, Reseller, User } = require('@ayka/db')
const logger = require('../utils/logger')

router.use(authenticateJWT, requireRole('superadmin'))

const toObjectId = (id) => new mongoose.Types.ObjectId(id)

function maskMongoUri(uri) {
  if (!uri) return null
  return String(uri).replace(/:\/\/([^:]+):([^@]+)@/, '://$1:***@')
}

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

// GET /api/superadmin/stats
router.get('/stats', asyncHandler(async (req, res) => {
  const now = new Date()
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)
  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)
  const hourAgo = new Date(now.getTime() - 3600000)

  const [
    totalResellers, totalClients,
    convosToday, messagesToday,
    hotLeadsMonth, visitsMonth,
  ] = await Promise.all([
    Reseller.countDocuments({ isActive: true }),
    Business.countDocuments({ isActive: true }),
    Conversation.countDocuments({ createdAt: { $gte: todayStart } }),
    Message.countDocuments({ createdAt: { $gte: todayStart } }),
    Conversation.countDocuments({ leadScore: 'hot', createdAt: { $gte: monthStart } }),
    Conversation.countDocuments({ 'flowState.visitConfirmed': true, createdAt: { $gte: monthStart } }),
  ])

  res.json({
    totalResellers: { value: totalResellers },
    totalClients: { value: totalClients },
    conversationsToday: { value: convosToday },
    messagesToday: { value: messagesToday },
    hotLeadsMonth: { value: hotLeadsMonth },
    visitsMonth: { value: visitsMonth },
    errorRate: { value: 0.1 },
    avgLatency: { value: 280 },
  })
}))

// GET /api/superadmin/charts/platform-volume
router.get('/charts/platform-volume', asyncHandler(async (req, res) => {
  const days = parseInt(req.query.days) || 30
  const start = new Date()
  start.setDate(start.getDate() - days)

  const [convos, messages] = await Promise.all([
    Conversation.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
    Message.aggregate([
      { $match: { createdAt: { $gte: start } } },
      { $group: { _id: { $dateToString: { format: '%Y-%m-%d', date: '$createdAt', timezone: 'Asia/Kolkata' } }, count: { $sum: 1 } } },
      { $sort: { _id: 1 } },
    ]),
  ])

  res.json({ conversations: convos, messages })
}))

// GET /api/superadmin/charts/revenue
router.get('/charts/revenue', asyncHandler(async (req, res) => {
  const resellers = await Reseller.find({ isActive: true }).lean()

  const results = []
  for (const r of resellers) {
    const clientCount = await Business.countDocuments({ resellerId: r._id, isActive: true })
    const monthlyRevenue = clientCount * (r.pricing?.monthlyPerBot || 0)
    const setupRevenue = r.pricing?.setupCost || 0
    results.push({
      name: r.name,
      clients: clientCount,
      monthly: monthlyRevenue,
      setup: setupRevenue,
      revenue: setupRevenue + clientCount * (r.pricing?.perBotCost || 0) + monthlyRevenue,
    })
  }

  res.json(results)
}))

// GET /api/superadmin/charts/reseller-performance
router.get('/charts/reseller-performance', asyncHandler(async (req, res) => {
  const { start } = (() => {
    const s = new Date()
    s.setDate(1)
    s.setHours(0, 0, 0, 0)
    return { start: s }
  })()

  const data = await Conversation.aggregate([
    { $match: { createdAt: { $gte: start } } },
    { $group: {
      _id: { resellerId: '$resellerId', score: '$leadScore' },
      count: { $sum: 1 },
    }},
  ])

  const resellerIds = [...new Set(data.map(d => d._id.resellerId.toString()))]
  const resellers = await Reseller.find({ _id: { $in: resellerIds } }, { name: 1 }).lean()
  const nameMap = {}
  resellers.forEach(r => { nameMap[r._id.toString()] = r.name })

  const result = {}
  data.forEach(d => {
    const rid = d._id.resellerId.toString()
    if (!result[rid]) result[rid] = { name: nameMap[rid] || 'Unknown', hot: 0, warm: 0, cold: 0, total: 0 }
    result[rid][d._id.score] = d.count
    result[rid].total += d.count
  })

  res.json(Object.values(result))
}))

// GET /api/superadmin/charts/vertical-distribution
router.get('/charts/vertical-distribution', asyncHandler(async (req, res) => {
  const data = await Business.aggregate([
    { $match: { isActive: true } },
    { $group: { _id: '$vertical', count: { $sum: 1 } } },
  ])

  res.json(data)
}))

// GET /api/superadmin/charts/system-health
router.get('/charts/system-health', asyncHandler(async (req, res) => {
  // Simulated system health data — in production, pull from monitoring
  const hours = parseInt(req.query.hours) || 24
  const data = []
  const now = Date.now()
  for (let i = hours; i >= 0; i--) {
    data.push({
      timestamp: new Date(now - i * 3600000).toISOString(),
      responseTime: 200 + Math.random() * 150,
      errorRate: Math.random() * 0.5,
      groqLatency: 250 + Math.random() * 100,
    })
  }
  res.json(data)
}))

// GET /api/superadmin/resellers
router.get('/resellers', asyncHandler(async (req, res) => {
  const resellers = await Reseller.find().lean()

  const results = []
  for (const r of resellers) {
    const clientCount = await Business.countDocuments({ resellerId: r._id, isActive: true })
    const monthStart = new Date()
    monthStart.setDate(1)
    monthStart.setHours(0, 0, 0, 0)

    const leadsThisMonth = await Conversation.countDocuments({ resellerId: r._id, createdAt: { $gte: monthStart } })
    const hotLeads = await Conversation.countDocuments({ resellerId: r._id, leadScore: 'hot', createdAt: { $gte: monthStart } })

    results.push({
      ...r,
      activeClients: clientCount,
      botSlotsUsed: clientCount,
      leadsThisMonth,
      hotLeads,
      revenue: (r.pricing?.setupCost || 0) + clientCount * ((r.pricing?.perBotCost || 0) + (r.pricing?.monthlyPerBot || 0)),
    })
  }

  res.json(results)
}))

// GET /api/superadmin/clients
router.get('/clients', asyncHandler(async (req, res) => {
  const filter = {}
  if (req.query.resellerId) filter.resellerId = toObjectId(req.query.resellerId)

  const clients = await Business.find(filter).lean()

  const resellerIds = [...new Set(clients.filter(c => c.resellerId).map(c => c.resellerId.toString()))]
  const resellers = resellerIds.length ? await Reseller.find({ _id: { $in: resellerIds } }, { name: 1 }).lean() : []
  const nameMap = {}
  resellers.forEach(r => { nameMap[r._id.toString()] = r.name })

  const monthStart = new Date()
  monthStart.setDate(1)
  monthStart.setHours(0, 0, 0, 0)

  const leadCounts = await Conversation.aggregate([
    { $match: { businessId: { $in: clients.map(c => c._id) }, createdAt: { $gte: monthStart } } },
    { $group: {
      _id: { businessId: '$businessId', score: '$leadScore' },
      count: { $sum: 1 },
    }},
  ])

  const countMap = {}
  leadCounts.forEach(l => {
    const bid = l._id.businessId.toString()
    if (!countMap[bid]) countMap[bid] = { total: 0, hot: 0 }
    countMap[bid][l._id.score] = l.count
    countMap[bid].total += l.count
  })

  const lastActivity = await Conversation.aggregate([
    { $match: { businessId: { $in: clients.map(c => c._id) } } },
    { $group: { _id: '$businessId', lastActivity: { $max: '$updatedAt' } } },
  ])
  const activityMap = {}
  lastActivity.forEach(a => { activityMap[a._id.toString()] = a.lastActivity })

  res.json(clients.map(c => ({
    ...c,
    resellerName: c.resellerId ? (nameMap[c.resellerId.toString()] || 'Unknown') : 'Direct',
    leads: countMap[c._id.toString()] || { total: 0, hot: 0 },
    lastActivity: activityMap[c._id.toString()] || c.updatedAt,
  })))
}))

// GET /api/superadmin/leads
router.get('/leads', asyncHandler(async (req, res) => {
  const page = parseInt(req.query.page) || 1
  const limit = parseInt(req.query.limit) || 25
  const skip = (page - 1) * limit

  const filter = {}
  if (req.query.businessId) filter.businessId = toObjectId(req.query.businessId)
  if (req.query.resellerId) filter.resellerId = toObjectId(req.query.resellerId)
  if (req.query.score) filter.leadScore = { $in: req.query.score.split(',') }
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

  // Join business + reseller names and message counts
  const businessIds = [...new Set(leads.map(l => l.businessId.toString()))]
  const resellerIds = [...new Set(leads.filter(l => l.resellerId).map(l => l.resellerId.toString()))]

  const [businesses, resellers, msgCounts] = await Promise.all([
    Business.find({ _id: { $in: businessIds } }, { name: 1 }).lean(),
    resellerIds.length ? Reseller.find({ _id: { $in: resellerIds } }, { name: 1 }).lean() : [],
    Message.aggregate([
      { $match: { conversationId: { $in: leads.map(l => l._id) } } },
      { $group: { _id: '$conversationId', count: { $sum: 1 }, lastAt: { $max: '$timestamp' } } },
    ]),
  ])

  const bizMap = {}
  businesses.forEach(b => { bizMap[b._id.toString()] = b.name })
  const resMap = {}
  resellers.forEach(r => { resMap[r._id.toString()] = r.name })
  const msgMap = {}
  msgCounts.forEach(m => { msgMap[m._id.toString()] = { count: m.count, lastAt: m.lastAt } })

  const results = leads.map(l => ({
    _id: l._id,
    parentName: l.flowState?.collectedData?.parentName || l.contactId?.name || null,
    phone: l.phone,
    businessName: bizMap[l.businessId.toString()] || 'Unknown',
    resellerName: l.resellerId ? (resMap[l.resellerId.toString()] || 'Unknown') : 'Direct',
    leadScore: l.leadScore,
    leadScoreReason: l.leadScoreReason,
    messageCount: msgMap[l._id.toString()]?.count || 0,
    visitConfirmed: l.flowState?.visitConfirmed || false,
    lastMessageAt: msgMap[l._id.toString()]?.lastAt || l.updatedAt,
    createdAt: l.createdAt,
  }))

  res.json({ leads: results, total, page, totalPages: Math.ceil(total / limit) })
}))

// GET /api/superadmin/conversations/:conversationId/messages
router.get('/conversations/:conversationId/messages', asyncHandler(async (req, res) => {
  const limit = parseInt(req.query.limit) || 50

  const convo = await Conversation.findById(req.params.conversationId).lean()
  if (!convo) return res.status(404).json({ error: 'Conversation not found' })

  const filter = { conversationId: convo._id }
  if (req.query.before) filter.timestamp = { $lt: new Date(req.query.before) }

  const messages = await Message.find(filter).sort({ timestamp: -1 }).limit(limit + 1).lean()
  const hasMore = messages.length > limit
  const result = hasMore ? messages.slice(0, limit) : messages

  res.json({ messages: result.reverse(), hasMore, conversation: convo })
}))

// GET /api/superadmin/system/health
router.get('/system/health', asyncHandler(async (req, res) => {
  const [totalConversations, totalMessages, totalContacts, totalAppointments] = await Promise.all([
    Conversation.estimatedDocumentCount(),
    Message.estimatedDocumentCount(),
    Contact.estimatedDocumentCount(),
    Appointment.estimatedDocumentCount(),
  ])

  res.json({
    mongodb: { status: 'connected', collections: { conversations: totalConversations, messages: totalMessages, contacts: totalContacts, appointments: totalAppointments } },
    redis: { status: 'connected' },
    uptime: process.uptime(),
  })
}))

// GET /api/superadmin/system/runtime-source
router.get('/system/runtime-source', asyncHandler(async (req, res) => {
  const envMongoUri = process.env.MONGODB_URI || ''
  const envRedisUrl = process.env.REDIS_URL || ''
  const parsedMongo = parseMongoTarget(envMongoUri)

  const mongoConnection = mongoose.connection || {}
  const activeDbName = mongoConnection.name || mongoConnection.db?.databaseName || null
  const activeHost = mongoConnection.host || null
  const activePort = mongoConnection.port || null
  const readyState = mongoConnection.readyState
  const readyStateLabel = ({ 0: 'disconnected', 1: 'connected', 2: 'connecting', 3: 'disconnecting' })[readyState] || 'unknown'

  res.json({
    nodeEnv: process.env.NODE_ENV || null,
    apiUrl: process.env.API_URL || null,
    mongodb: {
      envUriMasked: maskMongoUri(envMongoUri),
      envTarget: parsedMongo,
      activeConnection: {
        state: readyStateLabel,
        host: activeHost,
        port: activePort,
        dbName: activeDbName,
      },
    },
    redis: {
      envUrl: envRedisUrl || null,
      hasPassword: Boolean(process.env.REDIS_PASSWORD),
    },
    llm: {
      primary: 'azure-openai',
      fallback: 'groq',
      azureEndpoint: process.env.AZURE_OPENAI_ENDPOINT || 'https://aykachatbot-resource.cognitiveservices.azure.com',
      hasAzureKey: Boolean(process.env.AZURE_OPENAI_KEY || process.env.AZURE_OPENAI_API_KEY),
      hasGroqKey: Boolean(process.env.GROQ_API_KEYS || process.env.GROQ_API_KEY),
    },
  })
}))

// GET /api/superadmin/system/errors
router.get('/system/errors', asyncHandler(async (req, res) => {
  // In production, pull from log aggregation. Stub for now.
  res.json([])
}))

// GET /api/superadmin/system/api-usage
router.get('/system/api-usage', asyncHandler(async (req, res) => {
  const todayStart = new Date()
  todayStart.setHours(0, 0, 0, 0)

  const messagesToday = await Message.countDocuments({ createdAt: { $gte: todayStart } })

  // Import LLM stats (includes Gemini + Groq breakdown)
  let llmStats = {}
  try {
    const { getLLMStats } = require('../services/llm.service')
    llmStats = getLLMStats()
  } catch (err) {
    logger.warn({ err }, 'Unable to load LLM stats for superadmin api-usage endpoint')
  }

  res.json({
    groqTokensToday: messagesToday * 500,
    groqTokensMonth: messagesToday * 500 * 30,
    costEstimate: `$${(messagesToday * 500 * 0.00000027).toFixed(2)}`,
    llm: llmStats,
  })
}))

// ─── RESELLER CRUD ──────────────────────────────────────────────────────────

// POST /api/superadmin/resellers
router.post('/resellers', asyncHandler(async (req, res) => {
  const { name, slug, email, phone, pricing, platformFeeStatus, themeConfig } = req.body
  if (!name || !slug || !email) return res.status(400).json({ error: 'Name, slug, and email are required' })

  const existing = await Reseller.findOne({ $or: [{ slug }, { email }] })
  if (existing) return res.status(409).json({ error: 'Reseller with this slug or email already exists' })

  const reseller = await Reseller.create({ name, slug, email, phone, pricing, platformFeeStatus, themeConfig })
  res.status(201).json(reseller)
}))

// PATCH /api/superadmin/resellers/:id
router.patch('/resellers/:id', asyncHandler(async (req, res) => {
  const updates = { ...req.body }
  delete updates._id

  const reseller = await Reseller.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true })
  if (!reseller) return res.status(404).json({ error: 'Reseller not found' })

  res.json(reseller)
}))

// DELETE /api/superadmin/resellers/:id (soft-delete: deactivates reseller + all their clients + users)
router.delete('/resellers/:id', asyncHandler(async (req, res) => {
  const reseller = await Reseller.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true })
  if (!reseller) return res.status(404).json({ error: 'Reseller not found' })

  await Business.updateMany({ resellerId: reseller._id }, { $set: { isActive: false } })
  await User.updateMany({ resellerId: reseller._id }, { $set: { isActive: false } })

  res.json({ message: 'Reseller and associated clients/users deactivated', reseller })
}))

// POST /api/superadmin/resellers/:id/reactivate
router.post('/resellers/:id/reactivate', asyncHandler(async (req, res) => {
  const reseller = await Reseller.findByIdAndUpdate(req.params.id, { $set: { isActive: true } }, { new: true })
  if (!reseller) return res.status(404).json({ error: 'Reseller not found' })

  res.json(reseller)
}))

// ─── CLIENT CRUD ────────────────────────────────────────────────────────────

// POST /api/superadmin/clients
router.post('/clients', asyncHandler(async (req, res) => {
  const { resellerId, name, slug, vertical, whatsapp, settings, subscription, pricing } = req.body
  if (!name || !slug || !vertical) {
    return res.status(400).json({ error: 'name, slug, and vertical are required' })
  }
  if (!whatsapp?.phoneNumberId || !whatsapp?.accessToken || !whatsapp?.wabaId || !whatsapp?.verifyToken) {
    return res.status(400).json({ error: 'WhatsApp config (phoneNumberId, accessToken, wabaId, verifyToken) is required' })
  }

  // If resellerId provided, validate reseller and bot slots
  if (resellerId) {
    const reseller = await Reseller.findById(resellerId)
    if (!reseller) return res.status(404).json({ error: 'Reseller not found' })
    if (!reseller.isActive) return res.status(400).json({ error: 'Reseller is deactivated' })

    const clientCount = await Business.countDocuments({ resellerId: reseller._id, isActive: true })
    if (clientCount >= (reseller.pricing?.botSlots || 5)) {
      return res.status(400).json({ error: `Reseller has reached max bot slots (${reseller.pricing?.botSlots || 5})` })
    }
  }

  // Encrypt access token before storage
  if (whatsapp.accessToken) whatsapp.accessToken = encrypt(whatsapp.accessToken)

  const client = await Business.create({ resellerId: resellerId || null, name, slug, vertical, whatsapp, settings, subscription, pricing })
  res.status(201).json(client)
}))

// PATCH /api/superadmin/clients/:id
router.patch('/clients/:id', asyncHandler(async (req, res) => {
  const updates = { ...req.body }
  delete updates._id

  // Encrypt access token if being updated
  if (updates.whatsapp?.accessToken) {
    updates.whatsapp.accessToken = encrypt(updates.whatsapp.accessToken)
  }

  const client = await Business.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true })
  if (!client) return res.status(404).json({ error: 'Client not found' })

  res.json(client)
}))

// DELETE /api/superadmin/clients/:id (soft-delete)
router.delete('/clients/:id', asyncHandler(async (req, res) => {
  const client = await Business.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true })
  if (!client) return res.status(404).json({ error: 'Client not found' })

  await User.updateMany({ businessId: client._id }, { $set: { isActive: false } })

  res.json({ message: 'Client and associated users deactivated', client })
}))

// POST /api/superadmin/clients/:id/reactivate
router.post('/clients/:id/reactivate', asyncHandler(async (req, res) => {
  const client = await Business.findByIdAndUpdate(req.params.id, { $set: { isActive: true } }, { new: true })
  if (!client) return res.status(404).json({ error: 'Client not found' })

  res.json(client)
}))

// ─── USER MANAGEMENT ────────────────────────────────────────────────────────

// GET /api/superadmin/users
router.get('/users', asyncHandler(async (req, res) => {
  const filter = {}
  if (req.query.role) filter.role = req.query.role
  if (req.query.resellerId) filter.resellerId = toObjectId(req.query.resellerId)
  if (req.query.businessId) filter.businessId = toObjectId(req.query.businessId)
  if (req.query.search) {
    const s = req.query.search.trim()
    filter.$or = [
      { email: { $regex: s, $options: 'i' } },
      { displayName: { $regex: s, $options: 'i' } },
    ]
  }

  const users = await User.find(filter).sort({ createdAt: -1 }).lean()

  const resellerIds = [...new Set(users.filter(u => u.resellerId).map(u => u.resellerId.toString()))]
  const businessIds = [...new Set(users.filter(u => u.businessId).map(u => u.businessId.toString()))]

  const [resellers, businesses] = await Promise.all([
    resellerIds.length ? Reseller.find({ _id: { $in: resellerIds } }, { name: 1 }).lean() : [],
    businessIds.length ? Business.find({ _id: { $in: businessIds } }, { name: 1 }).lean() : [],
  ])

  const resellerMap = {}; resellers.forEach(r => { resellerMap[r._id.toString()] = r.name })
  const businessMap = {}; businesses.forEach(b => { businessMap[b._id.toString()] = b.name })

  res.json(users.map(u => ({
    ...u,
    resellerName: u.resellerId ? resellerMap[u.resellerId.toString()] || 'Unknown' : null,
    businessName: u.businessId ? businessMap[u.businessId.toString()] || 'Unknown' : null,
  })))
}))

// POST /api/superadmin/users
router.post('/users', asyncHandler(async (req, res) => {
  const { email, password, role, displayName, businessId, resellerId, themeConfig } = req.body
  if (!email || !password || !role || !displayName) {
    return res.status(400).json({ error: 'email, password, role, and displayName are required' })
  }
  if (password.length < 8) {
    return res.status(400).json({ error: 'Password must be at least 8 characters' })
  }

  const existing = await User.findOne({ email: email.toLowerCase().trim() })
  if (existing) return res.status(409).json({ error: 'User with this email already exists' })

  const bcrypt = require('bcryptjs')
  const passwordHash = await bcrypt.hash(password, 12)

  const user = await User.create({
    email: email.toLowerCase().trim(),
    passwordHash,
    role,
    displayName,
    businessId: businessId || null,
    resellerId: resellerId || null,
    themeConfig: themeConfig || undefined,
  })

  const result = user.toObject()
  delete result.passwordHash
  res.status(201).json(result)
}))

// PATCH /api/superadmin/users/:id
router.patch('/users/:id', asyncHandler(async (req, res) => {
  const updates = { ...req.body }
  delete updates._id
  delete updates.passwordHash

  if (updates.newPassword) {
    if (updates.newPassword.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' })
    }
    const bcrypt = require('bcryptjs')
    updates.passwordHash = await bcrypt.hash(updates.newPassword, 12)
    delete updates.newPassword
  }

  const user = await User.findByIdAndUpdate(req.params.id, { $set: updates }, { new: true, runValidators: true }).select('-passwordHash')
  if (!user) return res.status(404).json({ error: 'User not found' })

  res.json(user)
}))

// DELETE /api/superadmin/users/:id (soft-delete)
router.delete('/users/:id', asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { $set: { isActive: false } }, { new: true }).select('-passwordHash')
  if (!user) return res.status(404).json({ error: 'User not found' })

  res.json({ message: 'User deactivated', user })
}))

// POST /api/superadmin/users/:id/reactivate
router.post('/users/:id/reactivate', asyncHandler(async (req, res) => {
  const user = await User.findByIdAndUpdate(req.params.id, { $set: { isActive: true } }, { new: true })
  if (!user) return res.status(404).json({ error: 'User not found' })

  res.json(user)
}))

module.exports = router
