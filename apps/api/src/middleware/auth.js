const jwt = require('jsonwebtoken')
const { User } = require('@ayka/db')

const JWT_SECRET = process.env.JWT_SECRET
if (!JWT_SECRET) {
  throw new Error('JWT_SECRET is required')
}

/**
 * authenticateJWT - Verifies JWT from Authorization header.
 * Attaches req.user with { userId, role, businessId, resellerId, themeConfig }
 */
function authenticateJWT(req, res, next) {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Authentication required' })
  }

  const token = authHeader.split(' ')[1]
  try {
    const payload = jwt.verify(token, JWT_SECRET)
    req.user = payload
    next()
  } catch (err) {
    return res.status(401).json({ error: 'Invalid or expired token' })
  }
}

/**
 * requireRole - Factory that returns middleware enforcing a specific role.
 * Usage: requireRole('client'), requireRole('reseller'), requireRole('superadmin')
 */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: 'Insufficient permissions' })
    }
    next()
  }
}

/**
 * enforceBusinessScope - Ensures client users can only access their own businessId.
 * Must come after authenticateJWT.
 */
function enforceBusinessScope(req, res, next) {
  if (req.user.role === 'client') {
    if (!req.user.businessId) {
      return res.status(403).json({ error: 'No business scope assigned' })
    }
  }
  next()
}

/**
 * enforceResellerScope - Ensures reseller users can only access their own resellerId.
 */
function enforceResellerScope(req, res, next) {
  if (req.user.role === 'reseller') {
    if (!req.user.resellerId) {
      return res.status(403).json({ error: 'No reseller scope assigned' })
    }
  }
  next()
}

/**
 * signToken - Creates a JWT token for a user document.
 */
function signToken(user) {
  const payload = {
    userId: user._id.toString(),
    role: user.role,
    businessId: user.businessId?.toString() || null,
    resellerId: user.resellerId?.toString() || null,
    themeConfig: user.themeConfig,
  }
  return jwt.sign(payload, JWT_SECRET, { expiresIn: '7d' })
}

module.exports = {
  authenticateJWT,
  requireRole,
  enforceBusinessScope,
  enforceResellerScope,
  signToken,
  JWT_SECRET,
}
