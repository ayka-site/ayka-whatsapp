const express = require('express')
const router = express.Router()
const mongoose = require('mongoose')
const crypto = require('crypto')
const fs = require('fs')
const path = require('path')
const multer = require('multer')
const { authenticateJWT, requireRole, enforceBusinessScope } = require('../middleware/auth')
const asyncHandler = require('../utils/asyncHandler')
const { Conversation, Contact, Message, Appointment, KnowledgeBase, Business, Property } = require('@ayka/db')
const { sendTextMessage } = require('../services/whatsapp.service')
const { decrypt } = require('../utils/encryption')
const logger = require('../utils/logger')
const redis = require('../config/redis')

// All client routes require auth + client role + business scope
router.use(authenticateJWT, requireRole('client'), enforceBusinessScope)

const toObjectId = (id) => new mongoose.Types.ObjectId(id)

function resolveAppointmentScheduledAt(appointment) {
  if (!appointment) return null
  if (appointment.scheduledAt) return appointment.scheduledAt
  const date = String(appointment.scheduledDate || '').trim()
  const time = String(appointment.scheduledTime || '').trim()
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !/^\d{2}:\d{2}$/.test(time)) return null
  return `${date}T${time}:00+05:30`
}

function serializeAppointment(appointment) {
  if (!appointment) return null
  return {
    ...appointment,
    scheduledAt: resolveAppointmentScheduledAt(appointment),
  }
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

/**
 * flushKbCacheForBusiness - Remove Redis KB cache for a business.
 * @param {string} businessId - Business identifier string.
 * @returns {Promise<boolean>} True when flush command succeeds.
 */
async function flushKbCacheForBusiness(businessId) {
  await redis.del(`kb:${businessId}`)
  return true
}

const REPLY_WINDOW_MS = 24 * 60 * 60 * 1000
const MAX_REPLY_TEXT_LENGTH = 2000
const PROPERTY_STATUS = new Set(['available', 'hold', 'sold', 'rented', 'inactive'])
const PROPERTY_LISTING_TYPES = new Set(['sale', 'rent', 'lease'])
const PROPERTY_TYPES = new Set(['apartment', 'villa', 'plot', 'floor', 'commercial', 'office', 'shop', 'farmhouse', 'other'])
const MEDIA_TYPES = new Set(['image', 'video'])
const PROPERTY_UPLOAD_ROOT = path.resolve(__dirname, '../../public/uploads/properties')
const PROPERTY_UPLOAD_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'video/mp4',
  'video/webm',
  'video/quicktime',
])
const PROPERTY_UPLOAD_EXTENSIONS = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'image/gif': '.gif',
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/quicktime': '.mov',
}

const propertyUpload = multer({
  storage: multer.diskStorage({
    destination(req, file, cb) {
      const businessId = String(req.user?.businessId || '').replace(/[^a-fA-F0-9]/g, '')
      const dest = path.join(PROPERTY_UPLOAD_ROOT, businessId || 'unknown')
      fs.mkdirSync(dest, { recursive: true })
      cb(null, dest)
    },
    filename(req, file, cb) {
      const ext = PROPERTY_UPLOAD_EXTENSIONS[file.mimetype] || path.extname(file.originalname || '').toLowerCase()
      cb(null, `${Date.now()}-${crypto.randomBytes(8).toString('hex')}${ext}`)
    },
  }),
  limits: {
    files: 20,
    fileSize: 50 * 1024 * 1024,
  },
  fileFilter(req, file, cb) {
    if (!PROPERTY_UPLOAD_MIME_TYPES.has(file.mimetype)) {
      return cb(new Error('Only JPG, PNG, WebP, GIF, MP4, WebM, and MOV files are supported'))
    }
    cb(null, true)
  },
})

function getReplyPolicy({ business, conversation, lastInboundAt }) {
  const settings = business?.settings || {}

  if (settings.dashboardHandoffReplyEnabled === false) {
    return { canReply: false, reason: 'feature_disabled', windowExpiresAt: null }
  }

  const isHandoffState = Boolean(conversation?.flowState?.handoffTriggered) || conversation?.status === 'handed_off'
  if (!isHandoffState) {
    return { canReply: false, reason: 'handoff_required', windowExpiresAt: null }
  }

  if (!lastInboundAt) {
    return { canReply: false, reason: 'no_inbound_message', windowExpiresAt: null }
  }

  const inboundAt = new Date(lastInboundAt)
  const windowExpiresAt = new Date(inboundAt.getTime() + REPLY_WINDOW_MS)
  const isWithinFreeWindow = Date.now() <= windowExpiresAt.getTime()

  if (isWithinFreeWindow) {
    return { canReply: true, reason: null, mode: 'free', windowExpiresAt }
  }

  if (settings.allowPaidReplies === true) {
    return { canReply: true, reason: null, mode: 'paid', windowExpiresAt }
  }

  return { canReply: false, reason: 'outside_24h_window', windowExpiresAt }
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

async function requireRealEstateBusiness(businessId, res) {
  const business = await Business.findById(businessId, { _id: 1, vertical: 1, resellerId: 1 }).lean()
  if (!business) {
    res.status(404).json({ error: 'Business not found' })
    return null
  }
  if (business.vertical !== 'realestate') {
    res.status(403).json({ error: 'Property management is available only for real estate clients' })
    return null
  }
  return business
}

function parseList(value) {
  if (Array.isArray(value)) return value.map(v => String(v).trim()).filter(Boolean)
  return String(value || '')
    .split(',')
    .map(v => v.trim())
    .filter(Boolean)
}

function normalizeMedia(media) {
  if (!Array.isArray(media)) return []
  return media
    .map(item => ({
      type: MEDIA_TYPES.has(String(item?.type || '').toLowerCase()) ? String(item.type).toLowerCase() : 'image',
      url: String(item?.url || '').trim(),
      caption: String(item?.caption || '').trim(),
    }))
    .filter(item => /^https?:\/\//i.test(item.url))
    .slice(0, 20)
}

function getPublicAssetUrl(req, relativePath) {
  const base = String(
    process.env.WHATSAPP_MEDIA_BASE_URL
    || process.env.API_PUBLIC_URL
    || process.env.PUBLIC_API_URL
    || process.env.API_URL
    || ''
  ).replace(/\/+$/, '')
  if (base) return `${base}${relativePath}`
  return `${req.protocol}://${req.get('host')}${relativePath}`
}

function normalizePropertyPayload(body, existing = {}) {
  const input = body || {}
  const locationInput = input.location || {}
  const location = {
    city: String(locationInput.city ?? input.city ?? existing.location?.city ?? '').trim(),
    locality: String(locationInput.locality ?? input.locality ?? existing.location?.locality ?? '').trim(),
    address: String(locationInput.address ?? input.address ?? existing.location?.address ?? '').trim(),
    landmark: String(locationInput.landmark ?? input.landmark ?? existing.location?.landmark ?? '').trim(),
    mapUrl: String(locationInput.mapUrl ?? input.mapUrl ?? existing.location?.mapUrl ?? '').trim(),
  }

  const status = String(input.status || existing.status || 'available').toLowerCase()
  const listingType = String(input.listingType || existing.listingType || 'sale').toLowerCase()
  const propertyType = String(input.propertyType || existing.propertyType || 'apartment').toLowerCase()
  const media = input.media !== undefined ? normalizeMedia(input.media) : existing.media

  return {
    title: String(input.title ?? existing.title ?? '').trim(),
    slug: String(input.slug ?? existing.slug ?? '').trim(),
    status: PROPERTY_STATUS.has(status) ? status : 'available',
    listingType: PROPERTY_LISTING_TYPES.has(listingType) ? listingType : 'sale',
    propertyType: PROPERTY_TYPES.has(propertyType) ? propertyType : 'other',
    bhk: String(input.bhk ?? existing.bhk ?? '').trim(),
    carpetArea: input.carpetArea === '' || input.carpetArea === undefined ? null : Number(input.carpetArea),
    builtUpArea: input.builtUpArea === '' || input.builtUpArea === undefined ? null : Number(input.builtUpArea),
    areaUnit: ['sqft', 'sqyd', 'sqm', 'acre', 'bigha'].includes(String(input.areaUnit || existing.areaUnit || 'sqft')) ? String(input.areaUnit || existing.areaUnit || 'sqft') : 'sqft',
    price: input.price === '' || input.price === undefined ? null : Number(input.price),
    priceLabel: String(input.priceLabel ?? existing.priceLabel ?? '').trim(),
    maintenance: input.maintenance === '' || input.maintenance === undefined ? null : Number(input.maintenance),
    negotiable: Boolean(input.negotiable ?? existing.negotiable ?? false),
    location,
    possession: String(input.possession ?? existing.possession ?? '').trim(),
    furnishing: ['', 'unfurnished', 'semi-furnished', 'fully-furnished'].includes(String(input.furnishing ?? existing.furnishing ?? '')) ? String(input.furnishing ?? existing.furnishing ?? '') : '',
    facing: String(input.facing ?? existing.facing ?? '').trim(),
    floor: String(input.floor ?? existing.floor ?? '').trim(),
    amenities: input.amenities !== undefined ? parseList(input.amenities) : existing.amenities,
    highlights: input.highlights !== undefined ? parseList(input.highlights) : existing.highlights,
    description: String(input.description ?? existing.description ?? '').trim(),
    media,
    contactPhone: String(input.contactPhone ?? existing.contactPhone ?? '').trim(),
    isFeatured: Boolean(input.isFeatured ?? existing.isFeatured ?? false),
    priority: Number(input.priority ?? existing.priority ?? 0),
  }
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
      activities.push({ type: 'handoff', description: `${name} - handoff triggered`, timestamp: c.flowState.handoffAt || c.updatedAt, conversationId: c._id })
    }
    if (c.flowState?.visitConfirmed) {
      activities.push({ type: 'visit_confirmed', description: `${name} - visit confirmed`, timestamp: c.flowState.visitConfirmedAt || c.updatedAt, conversationId: c._id })
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
    appointment: serializeAppointment(appointment),
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
    {
      $group: {
        _id: '$conversationId',
        lastMsg: {
          $first: {
            $cond: [
              { $eq: ['$content.contentType', 'image'] },
              { $concat: ['Photo: ', { $ifNull: ['$content.caption', '$content.text'] }] },
              {
                $cond: [
                  { $eq: ['$content.contentType', 'video'] },
                  { $concat: ['Video: ', { $ifNull: ['$content.caption', '$content.text'] }] },
                  '$content.text',
                ],
              },
            ],
          },
        },
        lastTime: { $first: '$timestamp' },
      },
    },
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

  const [convo, business] = await Promise.all([
    Conversation.findOne({ _id: req.params.conversationId, businessId }).lean(),
    Business.findById(businessId, { settings: 1 }).lean(),
  ])

  if (!convo) {
    return res.status(404).json({ error: 'Conversation not found' })
  }

  const filter = { conversationId: convo._id, businessId }

  if (req.query.before) {
    filter.timestamp = { $lt: new Date(req.query.before) }
  }

  const [messages, lastInbound] = await Promise.all([
    Message.find(filter).sort({ timestamp: -1 }).limit(limit + 1).lean(),
    Message.findOne({ conversationId: convo._id, businessId, direction: 'inbound' }, { timestamp: 1 }).sort({ timestamp: -1 }).lean(),
  ])

  const hasMore = messages.length > limit
  const result = hasMore ? messages.slice(0, limit) : messages
  const replyPolicy = getReplyPolicy({
    business,
    conversation: convo,
    lastInboundAt: lastInbound?.timestamp || null,
  })

  res.json({
    messages: result.reverse(),
    hasMore,
    conversation: convo,
    replyPolicy,
  })
}))

// POST /api/client/conversations/:conversationId/reply
router.post('/conversations/:conversationId/reply', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const text = String(req.body?.text || '').trim()

  if (!text) return res.status(400).json({ error: 'Reply text is required' })
  if (text.length > MAX_REPLY_TEXT_LENGTH) {
    return res.status(400).json({ error: `Reply text must be under ${MAX_REPLY_TEXT_LENGTH} characters` })
  }

  const [convo, business] = await Promise.all([
    Conversation.findOne({ _id: req.params.conversationId, businessId }).lean(),
    Business.findById(businessId, { whatsapp: 1, settings: 1 }).lean(),
  ])

  if (!convo) return res.status(404).json({ error: 'Conversation not found' })
  if (!business?.whatsapp?.phoneNumberId || !business?.whatsapp?.accessToken) {
    return res.status(400).json({ error: 'WhatsApp is not configured for this business' })
  }

  const lastInbound = await Message.findOne(
    { conversationId: convo._id, businessId, direction: 'inbound' },
    { timestamp: 1 }
  ).sort({ timestamp: -1 }).lean()

  const replyPolicy = getReplyPolicy({
    business,
    conversation: convo,
    lastInboundAt: lastInbound?.timestamp || null,
  })

  if (!replyPolicy.canReply) {
    return res.status(403).json({
      error: 'Reply is blocked for this conversation',
      reason: replyPolicy.reason,
      replyPolicy,
    })
  }

  let accessToken = business.whatsapp.accessToken
  if (String(accessToken).includes(':')) {
    try {
      accessToken = decrypt(accessToken)
    } catch (err) {
      logger.warn({ err, businessId }, 'Failed to decrypt WhatsApp access token, using raw value')
    }
  }

  let waResult
  try {
    waResult = await sendTextMessage(convo.phone, text, business.whatsapp.phoneNumberId, accessToken)
  } catch (err) {
    logger.error({ err, businessId, conversationId: convo._id }, 'Dashboard handoff reply send failed')
    return res.status(502).json({ error: 'Failed to send message to WhatsApp' })
  }

  const waMessageId = waResult?.messages?.[0]?.id || null
  const message = await Message.create({
    conversationId: convo._id,
    businessId,
    contactId: convo.contactId,
    direction: 'outbound',
    role: 'assistant',
    content: { contentType: 'text', text },
    waMessageId,
    status: 'sent',
    timestamp: new Date(),
  })

  await Conversation.updateOne({ _id: convo._id }, { $set: { updatedAt: new Date() } })

  res.json({
    success: true,
    message,
    replyPolicy,
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

  res.json({
    appointments: appointments.map(serializeAppointment),
    total,
    page,
    totalPages: Math.ceil(total / limit),
  })
}))

// GET /api/client/properties
router.get('/properties', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const business = await requireRealEstateBusiness(businessId, res)
  if (!business) return

  const page = Math.max(parseInt(req.query.page) || 1, 1)
  const limit = Math.min(Math.max(parseInt(req.query.limit) || 25, 1), 100)
  const skip = (page - 1) * limit

  const filter = { businessId }
  if (req.query.status) filter.status = { $in: String(req.query.status).split(',').filter(Boolean) }
  if (req.query.type) filter.propertyType = req.query.type
  if (req.query.listingType) filter.listingType = req.query.listingType
  if (req.query.search) {
    const s = String(req.query.search).trim()
    filter.$or = [
      { title: { $regex: s, $options: 'i' } },
      { 'location.locality': { $regex: s, $options: 'i' } },
      { 'location.city': { $regex: s, $options: 'i' } },
      { bhk: { $regex: s, $options: 'i' } },
    ]
  }

  const [properties, total] = await Promise.all([
    Property.find(filter).sort({ isFeatured: -1, priority: -1, updatedAt: -1 }).skip(skip).limit(limit).lean(),
    Property.countDocuments(filter),
  ])

  res.json({ properties, total, page, totalPages: Math.ceil(total / limit) })
}))

// POST /api/client/properties/media
router.post('/properties/media', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const business = await requireRealEstateBusiness(businessId, res)
  if (!business) return

  try {
    await new Promise((resolve, reject) => {
      propertyUpload.array('media', 20)(req, res, (err) => {
        if (err) return reject(err)
        resolve()
      })
    })
  } catch (err) {
    const message = err?.code === 'LIMIT_FILE_SIZE'
      ? 'Each upload must be 50 MB or smaller'
      : err?.message || 'Unable to upload files'
    return res.status(400).json({ error: message })
  }

  const files = req.files || []
  if (!files.length) return res.status(400).json({ error: 'Select at least one photo or video' })

  const media = files.map(file => {
    const businessFolder = String(req.user.businessId).replace(/[^a-fA-F0-9]/g, '')
    const relativePath = `/assets/uploads/properties/${businessFolder}/${file.filename}`
    return {
      type: file.mimetype.startsWith('video/') ? 'video' : 'image',
      url: getPublicAssetUrl(req, relativePath),
      caption: '',
      originalName: file.originalname,
      size: file.size,
    }
  })

  res.status(201).json({ media })
}))

// GET /api/client/properties/:propertyId
router.get('/properties/:propertyId', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const business = await requireRealEstateBusiness(businessId, res)
  if (!business) return

  const property = await Property.findOne({ _id: req.params.propertyId, businessId }).lean()
  if (!property) return res.status(404).json({ error: 'Property not found' })
  res.json(property)
}))

// POST /api/client/properties
router.post('/properties', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const business = await requireRealEstateBusiness(businessId, res)
  if (!business) return

  const payload = normalizePropertyPayload(req.body)
  if (!payload.title) return res.status(400).json({ error: 'Property title is required' })
  if (!payload.location.locality && !payload.location.city) {
    return res.status(400).json({ error: 'Locality or city is required' })
  }

  const property = await Property.create({
    ...payload,
    businessId,
    resellerId: business.resellerId || null,
  })
  res.status(201).json(property)
}))

// PATCH /api/client/properties/:propertyId
router.patch('/properties/:propertyId', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const business = await requireRealEstateBusiness(businessId, res)
  if (!business) return

  const existing = await Property.findOne({ _id: req.params.propertyId, businessId }).lean()
  if (!existing) return res.status(404).json({ error: 'Property not found' })

  const payload = normalizePropertyPayload(req.body, existing)
  if (!payload.title) return res.status(400).json({ error: 'Property title is required' })

  const property = await Property.findOneAndUpdate(
    { _id: req.params.propertyId, businessId },
    { $set: payload },
    { new: true, runValidators: true },
  )
  res.json(property)
}))

// DELETE /api/client/properties/:propertyId
router.delete('/properties/:propertyId', asyncHandler(async (req, res) => {
  const businessId = toObjectId(req.user.businessId)
  const business = await requireRealEstateBusiness(businessId, res)
  if (!business) return

  const property = await Property.findOneAndUpdate(
    { _id: req.params.propertyId, businessId },
    { $set: { status: 'inactive' } },
    { new: true },
  )
  if (!property) return res.status(404).json({ error: 'Property not found' })
  res.json({ success: true, property })
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
