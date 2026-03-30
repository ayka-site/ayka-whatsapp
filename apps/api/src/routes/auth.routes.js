const express = require('express')
const router = express.Router()
const bcrypt = require('bcryptjs')
const { User, Business } = require('@ayka/db')
const { authenticateJWT, signToken } = require('../middleware/auth')
const asyncHandler = require('../utils/asyncHandler')

// ─── LOGIN RATE LIMITER (10 attempts per IP per 15 min) ─────────
const loginAttempts = new Map()
const LOGIN_LIMIT  = 10
const LOGIN_WINDOW = 15 * 60 * 1000 // 15 minutes

function loginRateLimiter(req, res, next) {
  const ip = req.ip || req.connection.remoteAddress
  const now = Date.now()
  const entry = loginAttempts.get(ip)

  if (!entry || now - entry.windowStart > LOGIN_WINDOW) {
    loginAttempts.set(ip, { count: 1, windowStart: now })
    return next()
  }

  if (entry.count >= LOGIN_LIMIT) {
    const retryAfter = Math.ceil((entry.windowStart + LOGIN_WINDOW - now) / 1000)
    return res.status(429).json({ error: 'Too many login attempts. Please try again later.', retryAfter })
  }

  entry.count++
  next()
}

// Cleanup stale entries every 5 minutes
setInterval(() => {
  const now = Date.now()
  for (const [ip, entry] of loginAttempts) {
    if (now - entry.windowStart > LOGIN_WINDOW * 2) loginAttempts.delete(ip)
  }
}, 5 * 60 * 1000)

async function buildAuthUserPayload(user) {
  const payload = {
    id: user._id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    businessId: user.businessId,
    resellerId: user.resellerId,
    themeConfig: user.themeConfig,
  }

  if (user.role !== 'client' || !user.businessId) {
    return payload
  }

  const business = await Business.findById(user.businessId, {
    name: 1,
    settings: 1,
    widget: 1,
  }).lean()

  if (!business) return payload

  const existingTheme = payload.themeConfig || {}
  payload.themeConfig = {
    ...existingTheme,
    brandName: existingTheme.brandName
      || business.widget?.brandName
      || business.settings?.displayName
      || business.name
      || 'Dashboard',
    logoUrl: existingTheme.logoUrl
      || business.widget?.agentAvatar
      || existingTheme.faviconUrl
      || '',
  }

  return payload
}

// POST /api/auth/login
router.post('/login', loginRateLimiter, asyncHandler(async (req, res) => {
  const { email, password } = req.body
  if (!email || !password) {
    return res.status(400).json({ error: 'Email and password required' })
  }

  const user = await User.findOne({ email: email.toLowerCase().trim() }).select('+passwordHash')
  if (!user) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  if (!user.isActive) {
    return res.status(401).json({ error: 'Account is deactivated' })
  }

  const valid = await bcrypt.compare(password, user.passwordHash)
  if (!valid) {
    return res.status(401).json({ error: 'Invalid credentials' })
  }

  // Update last login
  await User.updateOne({ _id: user._id }, { $set: { lastLoginAt: new Date() } })

  const token = signToken(user)
  const authUser = await buildAuthUserPayload(user)

  res.json({
    token,
    user: authUser,
  })
}))

// GET /api/auth/me
router.get('/me', authenticateJWT, asyncHandler(async (req, res) => {
  const user = await User.findById(req.user.userId)
  if (!user || !user.isActive) {
    return res.status(401).json({ error: 'User not found or deactivated' })
  }

  const authUser = await buildAuthUserPayload(user)
  res.json({ ...authUser, lastLoginAt: user.lastLoginAt })
}))

// POST /api/auth/change-password
router.post('/change-password', authenticateJWT, asyncHandler(async (req, res) => {
  const { currentPassword, newPassword } = req.body
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current password and new password required' })
  }

  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' })
  }

  const user = await User.findById(req.user.userId).select('+passwordHash')
  if (!user) {
    return res.status(404).json({ error: 'User not found' })
  }

  const valid = await bcrypt.compare(currentPassword, user.passwordHash)
  if (!valid) {
    return res.status(401).json({ error: 'Current password is incorrect' })
  }

  const newHash = await bcrypt.hash(newPassword, 12)
  await User.updateOne({ _id: user._id }, { $set: { passwordHash: newHash } })

  res.json({ message: 'Password changed successfully' })
}))

module.exports = router