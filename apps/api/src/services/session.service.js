const redis = require('../config/redis')
const { Message, Conversation } = require('@ayka/db')
const logger = require('../utils/logger')

/**
 * session.service.js v4.0 — Redis-first session management with MongoDB fallback
 *
 * Architecture:
 *   Read:  Redis → (miss or failure) → MongoDB → write-back to Redis
 *   Write: Redis only (MongoDB is updated separately via conversation.engine.js)
 *   Clear: Redis delete
 *
 * Fixes over v3.0:
 *   1. All Redis calls wrapped in try/catch — Redis failure never crashes the bot
 *   2. Stale session detection: validates conversationId still exists in MongoDB
 *   3. Proper logging via pino (no console.error)
 */

const SESSION_TTL   = 86400 // 24 hours
const MAX_MESSAGES  = 20    // store last 20 messages in session (enough for 35-40 msg convos)
const MAX_SESSION_AGE_DAYS = 180

function sessionKey(businessId, phone) {
  return `session:${businessId}:${phone}`
}

// ═════════════════════════════════════════════════════════════════════════════
// getSession — Redis-first with MongoDB fallback
// ═════════════════════════════════════════════════════════════════════════════
async function getSession(businessId, phone) {
  const key = sessionKey(businessId, phone)

  // ── Try Redis first ──
  try {
    const cached = await redis.get(key)
    if (cached) {
      const session = typeof cached === 'string' ? JSON.parse(cached) : cached

      // Validate: if the cached conversationId no longer exists in MongoDB
      // (e.g. deleted during testing), wipe the stale Redis entry and rebuild
      if (session.conversationId) {
        // Check for both 'active' and 'handed_off' — after handoff the conversation
        // still exists and session data is valid. Only wipe truly deleted conversations.
        const stillValid = await Conversation.exists({
          _id: session.conversationId,
          status: { $in: ['active', 'handed_off'] },
        })
        if (!stillValid) {
          await redis.del(key).catch(delErr =>
            logger.warn({ delErr, key }, 'Failed to clear stale Redis session')
          ) // best-effort cleanup
          // Fall through to MongoDB rebuild ↓
        } else {
          const lastUpdatedMs = Number(session.lastUpdatedAt || 0)
          const maxAgeMs = MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000
          if (lastUpdatedMs && (Date.now() - lastUpdatedMs) > maxAgeMs) {
            await redis.del(key).catch(delErr =>
              logger.warn({ delErr, key }, 'Failed to clear expired Redis session')
            )
          } else {
            return session
          }
        }
      } else {
        return session
      }
    }
  } catch (err) {
    // Redis is down or returned bad data — fall through to MongoDB
    logger.warn({ err, businessId, phone }, 'Redis getSession failed — falling back to MongoDB')
  }

  // ── Fallback: rebuild session from MongoDB ──
  try {
    const convo = await Conversation.findOne(
      {
        businessId,
        phone,
        status: { $in: ['active', 'handed_off'] },
        updatedAt: { $gte: new Date(Date.now() - (MAX_SESSION_AGE_DAYS * 24 * 60 * 60 * 1000)) },
      }
    ).sort({ _id: -1 }).lean()
    if (!convo) return null

    const messages = await Message.find(
      { conversationId: convo._id, businessId },
      { role: 1, content: 1, timestamp: 1 }
    )
      .sort({ timestamp: -1 })
      .limit(MAX_MESSAGES)
      .lean()

    const session = {
      businessId,
      resellerId: convo.resellerId?.toString(),
      vertical:   convo.vertical,
      phone,
      conversationId: convo._id.toString(),
      contactId:      convo.contactId?.toString(),
      flowState:      convo.flowState,
      recentMessages: messages.reverse(),
      lastUpdatedAt: Date.now(),
    }

    // Write-back to Redis (best-effort — if Redis is down, we still work)
    try {
      await redis.set(key, JSON.stringify(session), { ex: SESSION_TTL })
    } catch (cacheErr) {
      logger.warn({ cacheErr }, 'Redis write-back failed — continuing without cache')
    }

    return session
  } catch (err) {
    logger.error({ err, businessId, phone }, 'MongoDB session rebuild failed')
    return null
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// saveSession — write to Redis (best-effort)
// ═════════════════════════════════════════════════════════════════════════════
async function saveSession(session) {
  const key = sessionKey(session.businessId, session.phone)
  try {
    session.lastUpdatedAt = Date.now()
    await redis.set(key, JSON.stringify(session), { ex: SESSION_TTL })
  } catch (err) {
    // Redis failure on save is non-fatal — next request will rebuild from MongoDB
    logger.warn({ err, businessId: session.businessId }, 'Redis saveSession failed — session will rebuild from MongoDB on next request')
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// clearSession — delete from Redis (best-effort)
// ═════════════════════════════════════════════════════════════════════════════
async function clearSession(businessId, phone) {
  try {
    await redis.del(sessionKey(businessId, phone))
  } catch (err) {
    logger.warn({ err, businessId }, 'Redis clearSession failed')
  }
}

module.exports = { getSession, saveSession, clearSession }
