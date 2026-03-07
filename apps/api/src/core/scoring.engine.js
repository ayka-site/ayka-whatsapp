/**
 * scoring.engine.js — Pure deterministic lead scoring engine
 *
 * Architecture:
 *   Takes a flowState + vertical string → returns { score, reason }
 *   Score is one of: 'hot', 'warm', 'cold'
 *   Reason is a human-readable string for the dashboard
 *
 * Design principles:
 *   1. ZERO external dependencies — no DB, no Redis, no LLM, no network
 *   2. Fully testable in isolation with plain JS objects
 *   3. Vertical-aware — scoring rules are loaded from vertical config files
 *   4. Deterministic — same input always produces same output
 *   5. Multi-tenant safe — no global state, no side effects
 */
const logger = require('../utils/logger')

// ═════════════════════════════════════════════════════════════════════════════
// Vertical config registry — lazy-loaded, cached after first access
// ═════════════════════════════════════════════════════════════════════════════
const _configCache = {}

function loadVerticalConfig(vertical) {
  if (_configCache[vertical]) return _configCache[vertical]

  try {
    const config = require(`../verticals/${vertical}/config`)
    _configCache[vertical] = config
    return config
  } catch (err) {
    logger.warn({ err, vertical }, 'Vertical config not found for scoring')
    return null
  }
}

// ═════════════════════════════════════════════════════════════════════════════
// computeLeadScore — the single public API
//
// @param  {Object} flowState  — session.flowState (collectedData, goals, handoffTriggered, etc.)
// @param  {string} vertical   — 'school', 'realestate', etc.
// @returns {{ score: 'hot'|'warm'|'cold', reason: string }}
// ═════════════════════════════════════════════════════════════════════════════
function computeLeadScore(flowState, vertical) {
  if (!flowState) {
    return { score: 'cold', reason: 'No conversation data yet' }
  }

  const config = loadVerticalConfig(vertical)
  const rules  = config?.scoringRules

  // If the vertical has no scoring rules defined, fall back to generic scoring
  if (!rules) {
    return _genericScore(flowState)
  }

  // Evaluate in priority order: hot → warm → cold
  // Each rule function receives flowState and returns a reason string (truthy) or null (falsy)
  const hotReason = typeof rules.hot === 'function' ? rules.hot(flowState) : null
  if (hotReason) {
    return { score: 'hot', reason: hotReason }
  }

  const warmReason = typeof rules.warm === 'function' ? rules.warm(flowState) : null
  if (warmReason) {
    return { score: 'warm', reason: warmReason }
  }

  // Cold — use the vertical's cold reason generator if provided, else generic
  const coldReason = typeof rules.cold === 'function'
    ? rules.cold(flowState)
    : _genericColdReason(flowState)

  return { score: 'cold', reason: coldReason }
}

// ═════════════════════════════════════════════════════════════════════════════
// Generic fallback scoring — used when a vertical has no scoringRules
// ═════════════════════════════════════════════════════════════════════════════
function _genericScore(flowState) {
  const collected = flowState.collectedData || {}
  const goals     = flowState.goals || {}

  // Hot: handoff triggered or visit time captured
  if (flowState.handoffTriggered || collected.preferredVisitTime) {
    const parts = []
    if (flowState.handoffTriggered)    parts.push('Handoff triggered')
    if (collected.preferredVisitTime)  parts.push(`Visit: ${collected.preferredVisitTime}`)
    return { score: 'hot', reason: parts.join(', ') }
  }

  // Warm: at least 2 key data points collected
  const filledFields = [
    collected.parentName,
    collected.studentName,
    collected.interestedClass,
    collected.altPhone,
  ].filter(Boolean).length

  if (filledFields >= 2) {
    return { score: 'warm', reason: `${filledFields} data points collected` }
  }

  return { score: 'cold', reason: _genericColdReason(flowState) }
}

function _genericColdReason(flowState) {
  const collected = flowState.collectedData || {}
  const filledFields = [
    collected.parentName,
    collected.studentName,
    collected.interestedClass,
    collected.altPhone,
  ].filter(Boolean).length

  if (filledFields === 0) return 'No information collected yet'
  if (filledFields === 1) return 'Only 1 data point collected'
  return 'Insufficient data for warm/hot classification'
}

module.exports = { computeLeadScore }
