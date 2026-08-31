# AyKa AI Platform — Complete Product & Codebase Report

> **Purpose:** This document is a comprehensive, machine-readable analysis of the AyKa codebase so that an AI agent can quickly understand the product, its architecture, every file, every function, the data model, integrations, and operational concerns — without re-reading the source tree.
>
> **Generated:** 2026-08-01 · **Repo:** `/home/rudra/Ayka/ayka` · **Branch:** `master`

---

## 1. Product Overview

**AyKa** is a multi-tenant, AI-powered **lead-generation and CRM platform** for Indian businesses (schools, coaching institutes, and real-estate agencies). It provides:

1. **WhatsApp AI Chatbot** ("Priya" for schools, "Riya" for coaching, "Ria" for real estate) that converses with prospective customers/parents in Hindi, Hinglish, or English. It answers from a business knowledge base, collects lead data, qualifies leads (Hot/Warm/Cold), schedules school visits, and hands off to human staff.
2. **Embeddable Web Chat Widget** (`ayka-widget.js`) that mirrors the WhatsApp bot on any website.
3. **Next.js Management Dashboard** with three roles:
   - **Superadmin** — platform operator (manage resellers, clients, users, system health).
   - **Reseller** (labeled "admin" in UI) — white-label channel partner managing multiple client businesses.
   - **Client** — the business owner (leads, conversations with reply capability, appointments, real-estate property inventory, settings).
4. **Real-estate vertical** with property inventory CRUD and bot-driven property matching + photo galleries sent over WhatsApp.
5. **Lead scoring engine**, **visit scheduling** (school), **automated follow-ups** (real estate), **human handoff**, and **staff notifications**.

**Stack:** Node.js 20+ · Express 4 · Mongoose 8 (MongoDB) · Redis (ioredis) · Azure OpenAI (primary LLM, default `gpt-4.1-mini`, optional `responses` API mode) with Groq fallback (multi-key rotation) · JWT auth (7-day) · WhatsApp Cloud API v21.0 · Next.js 14 (App Router) · Tailwind · recharts · Docker/Azure Container Apps.

**Monorepo layout (npm workspaces):**

```
ayka/
├── apps/
│   ├── api/          # Express backend (@ayka/api) — port 3000
│   ├── dashboard/    # Next.js dashboard (@ayka/dashboard) — port 3001
│   └── widget/       # Prebuilt embeddable chat widget JS + demo.html
├── packages/
│   ├── db/           # 9 Mongoose models (@ayka/db)
│   └── shared/       # EMPTY placeholder package (@ayka/shared — unused)
├── services/
│   └── zoho-csdirect/ # EMPTY stub (0-byte README + .gitkeep)
├── infra/docker/     # API + dashboard Dockerfiles
├── docs/             # OPERATIONS.md, azure-optimization-report.md, devlog/
├── postman/          # Widget API test collection + environment
├── SPV/              # Source PDFs (school knowledge base data, non-code)
├── .github/workflows/# CI/CD (Azure Container Apps deploys)
└── docker-compose.yml, package.json, tsconfig.json, CODEBASE_MEMORY.md
```

---

## 2. End-to-End Data Flow

### 2.1 WhatsApp inbound path (the heart of the product)

```
Meta WhatsApp Cloud API webhook
  → POST /webhook/whatsapp  (webhook.routes.js)
  → verifyWebhook  (HMAC-SHA256 of rawBody with META_APP_SECRET, timing-safe)
  → resolveTenant  (Business lookup by whatsapp.phoneNumberId, Redis-cached 600s, decrypts access token)
  → rateLimiter    (Redis sliding window: 20 msgs / 60s per business+phone)
  → whatsapp.handler.handleWhatsAppWebhook
      - replies res.sendStatus(200) immediately, then processes async
      - dedup via Redis `processed:<waId>` (5 min)
      - status updates (delivered/read) → Message.updateOne
      - rate-limited → one "just a moment" message, drops rest
      - optional BOS bridge → publishes to Redis `ayka:whatsapp:inbound` and exits
      - else → conversation.engine.processMessage(req)
```

`processMessage` (conversation.engine.js) pipeline:

1. Parse payload, normalize phone to E.164.
2. Two-layer **dedup** (in-memory Map + Redis `dedup:<businessId>:<waMessageId>`).
3. Resolve message text (text/interactive/audio→Groq Whisper transcription/image/document/location/contacts).
4. Media/image early-handling with language-aware acknowledgements.
5. Acquire **process lock** (`lock:process:<businessId>:<phone>`, Redis SET NX, TTL default 45s, Lua compare-and-delete release).
6. Load **session** (Redis `session:<businessId>:<phone>`; Mongo rebuild fallback).
7. Upsert **Contact**; reuse/create **Conversation** (with CTWA ad source attribution).
8. Load **KnowledgeBase** (Redis `kb:<businessId>` cached 3600s; real-estate injects up to 12 Property docs).
9. Build system prompt (`prompt.builder.buildSystemPrompt`).
10. Call **LLM** (`llm.service.callLLM` → Azure → Groq fallback; content-filter detection).
11. Parse AI response (`flow.engine.parseAIResponse` — extracts HANDOFF / VISIT_CONFIRMED / NAME_* / real-estate markers).
12. Extract structured data (`flow.engine.extractDataFromMessages` — regex/NLP for names, class, budget, visit time, etc.).
13. Score the lead (`scoring.engine.computeLeadScore`).
14. **Handoff** to staff (WhatsApp notification) if triggered.
15. **Schedule visit** (`scheduling.engine.scheduleVisit`) if VISIT_CONFIRMED; fallback reply on invalid time.
16. Send reply via `whatsapp.service.sendTextMessage`; fire-and-forget Mongo writes (Message in/out, Contact, Conversation).
17. Real-estate extras: property media gallery pagination (batched image sends), property resolution.
18. Special flows: QR code image sending, Talent Hunt 2026 video reply override, language-aware error fallback.

### 2.2 Web widget path

```
Browser widget (ayka-widget.js)
  → GET  /widget/config/:businessId   (origin allowlist check)
  → POST /widget/init                  (issue visitorId + HttpOnly session cookie, 180d)
  → POST /widget/message               (in-memory rate limit 20/min/visitor)
  → web.conversation.engine.processWebMessage   (mirrors WhatsApp pipeline, returns JSON, no WA send)
```

### 2.3 Outbound bridge (async sends from other processes)

`index.js` subscribes to Redis channel `ayka:whatsapp:outbound`. Any process (e.g., BOS connector) publishes `{ to, text, phoneNumberId }` and the API resolves the tenant and sends via WhatsApp Cloud API.

---

## 3. Backend: `apps/api`

### 3.1 Entry point — `index.js` (~220 lines)

- Validates env (`validateEnv`), connects Mongo (`connectDB`, retries every 5s), starts the real-estate follow-up worker, configures CORS, mounts routers, listens on `PORT` (default 3000).
- **CORS:** `DEFAULT_ALLOWED_ORIGINS` = localhost:3001, dashboard.ayka.site, aykabot.ayka.site, ayka.site, www.ayka.site; `CORS_ALLOW_ALL=true` bypasses. Public paths (`/widget*`, `/health`, `/webhook/whatsapp`, `/assets`) allow any origin (no credentials); private paths require allowlisted origin (with credentials).
- **Raw body capture:** `express.json({ verify })` stores `req.rawBody` (needed for HMAC).
- **Static:** `/widget/embed` → `apps/widget/dist`; `/assets` → `public/` (7-day cache).
- **Mounts:** health+webhook at `/`; widget at `/widget`; auth at `/api/auth`; client/admin/superadmin at `/api/*`.

### 3.2 Config — `src/config/`

| File | Exports | Role |
|---|---|---|
| `env.js` | `validateEnv()` | Throws if `MONGODB_URI`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `ENCRYPTION_KEY`, `NODE_ENV`, `JWT_SECRET` missing; requires `AZURE_OPENAI_KEY` or `AZURE_OPENAI_API_KEY`; ENCRYPTION_KEY must match `^[0-9a-fA-F]{64}$`. |
| `db.js` | `connectDB()` | `mongoose.connect(MONGODB_URI, { serverSelectionTimeoutMS: 15000 })`, retry after 5s on failure. |
| `logger.js` | default pino logger | Redacts `phone`, `parentName`, `studentName`, `to`, `accessToken` paths; level from `LOG_LEVEL`; pino-pretty when non-prod. |
| `redis.js` | default `redis` object | ioredis TCP client wrapped to be **API-compatible with Upstash REST** (`get`/`set`/`del`/`pipeline()` with `{ex,px,nx}` translation). `_client` exposes raw ioredis. All consumers work unchanged against self-hosted Redis. |

### 3.3 Utils — `src/utils/`

| File | Exports | Role |
|---|---|---|
| `asyncHandler.js` | `asyncHandler(fn)` | Express async error wrapper (`.catch(next)`). |
| `encryption.js` | `encrypt(text)`, `decrypt(payload)` | **AES-256-GCM** with 32-byte hex `ENCRYPTION_KEY`. Format `ivHex:tagHex:ciphertextHex`. Protects WhatsApp access tokens at rest. |
| `logger.js` | default pino logger | Duplicate of config/logger with deeper redaction; most modules use this one. |
| `phone.js` | `normalizePhoneE164(raw)`, `toWhatsAppRecipient(normalized)` | Indian E.164 normalization (+91, 0-prefix, 10-digit); digits-only for WhatsApp Cloud API. |

### 3.4 Middleware — `src/middleware/`

| File | Exports | Role |
|---|---|---|
| `auth.js` | `authenticateJWT`, `requireRole(...roles)`, `enforceBusinessScope`, `enforceResellerScope`, `signToken(user)`, `JWT_SECRET` | JWT Bearer verify → `req.user = { userId, role, businessId, resellerId, themeConfig }`. `requireRole` → 403 unless role matches. `enforceBusinessScope`/`enforceResellerScope` require the matching id for client/reseller roles. `signToken` → 7-day expiry. |
| `resolveTenant.js` | default `resolveTenant(req,res,next)` | Loads `Business` by `whatsapp.phoneNumberId` (active only), decrypts token, caches under `tenant:<phoneNumberId>` 600s. No business → `res.sendStatus(200)` (prevents Meta retries). |
| `rateLimiter.js` | default `rateLimiter(req,res,next)` | Redis sorted-set sliding window: 20 msgs/60s per business+phone. On Redis error calls `next()` (not `next(err)`) so Meta never sees 5xx. Sets `req.normalizedPhone`, `req.isRateLimited`, `req.rateLimitCount`. |
| `verifyWebhook.js` | default `verifyWebhook(req,res,next)` | HMAC-SHA256(`META_APP_SECRET`, `req.rawBody`) compared with `x-hub-signature-256` via `crypto.timingSafeEqual`. Bypassable only when `SKIP_META_SIGNATURE_VERIFY=true` AND non-production. 401 on failure. |

### 3.5 Core Engines — `src/core/` (the brains)

#### `conversation.engine.js` (~975 lines) — main WhatsApp pipeline
**Export:** `processMessage(req)` (async). Full flow in §2.1. Notable helpers:
`escapeForRegex`, `normalizeStudentNameHonorific`, `normalizeRealEstateReply`, `normalizeMatchText`, `hasWord`, `scorePropertyForText`, `resolveMentionedProperty`, `buildVisitWindowFallbackReply`, `buildAutoVisitConfirmationReply`, `isQrCodeRequest`, `resolveQrImagePayloadWithDbFallback`, `buildQrIntroReply`, `isTalentHuntVideoRequest`, `buildTalentHuntVideoReply`, `isDuplicate`, `buildProcessLockKey`, `acquireProcessLock`, `releaseProcessLock`, `isContentFilterError`, `resolveMessageText`, `detectLanguageFromContext`.

Key tuning env: `PROCESS_LOCK_TTL_SECONDS` (45, min 15), `PROPERTY_IMAGE_BATCH_SIZE` (8, 1–10), `PROPERTY_IMAGE_MAX_SEND` (30, 1–50).

#### `web.conversation.engine.js` (~302 lines) — web widget pipeline
**Export:** `processWebMessage(businessId, visitorId, messageText, visitorInfo)` → `{ response, conversationId, flowState }` or `{ response: FALLBACK_MSG, error: true }`.
Mirrors the WhatsApp engine but: session key `web:<visitorId>`; no WhatsApp send (returns text); Contact matched by `webVisitorId` with `source: 'web_widget'`; pre-populates `parentName`/`altPhone` from `visitorInfo`; handoff lazy-loads token+phoneNumberId only when needed; no dedup/lock (widget routes do rate limiting).

#### `flow.engine.js` (~828 lines) — AI response parsing + data extraction
**Exports:** `parseAIResponse(rawResponse, flowState)`, `extractDataFromMessages(userMessage, aiResponse, flowState, recentMessages)`.
- `parseAIResponse`: extracts `NAME_PARENT:`/`NAME_STUDENT:` lines, real-estate markers (`BUYER_NAME, PROPERTY_TYPE, LISTING_TYPE, BHK, BUDGET, LOCATION, TIMELINE, PURPOSE, SITE_VISIT, PROPERTY_ID`), `HANDOFF: YES` (own line only), `VISIT_CONFIRMED: YYYY-MM-DD HH:MM`; strips marker lines; dedupes paragraphs.
- `extractDataFromMessages`: extensive regex/NLP — real-estate intent + budget/timeline parsing, rescheduling detection, goals tracking (`inquiryUnderstood`, `infoShared`, `visitSuggested`), parent/student name extraction (with profanity blocklist, honorifics, Devanagari, `isLikelyHumanName` validator), class extraction (Hindi ordinals, Devanagari digits), priorities keywords, altPhone (`[6-9]\d{9}`), visit-time detection (IST-aware: Mon–Sat 9:00–14:00 windows, out-of-hours blocking).

#### `prompt.builder.js` (~1337 lines) — system prompt generation ("PRIYA v4.0")
**Exports:** `buildKBSummary`, `sanitizeUserMessageForPrompt`, `detectScript`, `detectLanguage`, `detectEmotion`, `buildSystemPrompt`, `buildCoachingSystemPrompt`, `buildUltimatePriyaPrompt` (legacy alias).
- Routes by vertical → school/coaching/real-estate prompt.
- Personas: school=`Priya` (Senior Admissions Counsellor), coaching=`Riya`, realestate=`Ria` (from `tenantSettings.agentName`).
- `buildKBSummary(kb)` flattens Mongo KB `content` into fact bullets (name/address/fees/results/transport/hostel/FAQ/etc., catch-all for unknown string fields).
- Language detection (Devanagari vs Latin; devanagari/hinglish/english modes), emotion detection (keyword buckets), Bahraich-localization, religious greetings.
- **7 RULES** (answer-first, never hallucinate, memory sacred, one message one question, mirror language, HANDOFF criteria, stay in character) + RULE 6B visit-scheduling instructions with `VISIT_CONFIRMED` examples + machine control lines (`NAME_PARENT`/`NAME_STUDENT`) + RECENT CONVERSATION window (last 10 turns).
- Security: `escapePromptValue` and `sanitizeUserMessageForPrompt` strip prompt-injection markers and jailbreak phrases.

#### `scoring.engine.js` (~120 lines) — deterministic lead scoring
**Export:** `computeLeadScore(flowState, vertical)` → `{ score: 'hot'|'warm'|'cold', reason }`.
Zero I/O. Uses per-vertical `scoringRules` from `verticals/<vertical>/config`; generic fallback: hot if handoffTriggered or preferredVisitTime; warm if ≥2 of (parentName, studentName, interestedClass, altPhone); else cold.

#### `scheduling.engine.js` (~247 lines) — visit appointments
**Exports:** `scheduleVisit(session, tenant, visitDateTime)`, `isSchedulingEnabled(vertical)`.
Enabled only for school (`scheduling.enabled: true`). Validates `YYYY-MM-DD HH:MM`, rejects Sundays + outside 09:00–14:00 IST + past dates. Cancels existing confirmed appointment for the conversation (unique `conversationId` index), creates a new `Appointment` (status `confirmed`), denormalizes parent/student/class, notifies staff (bilingual WhatsApp message) with `staffNotified` tracking. Failures never block the parent response.

#### `handoff.engine.js` (~56 lines)
**Export:** `triggerHandoff(session, tenant)`.
Sends bilingual "New Admission Lead" notification to staff phone (settings → KB `content.handoff.staffPhone`) with parent/student/class/alt-phone. Never throws.

#### `followup.engine.js` (~144 lines) — real-estate auto follow-ups
**Exports:** `runRealEstateFollowUps()`, `startFollowUpWorker()`.
Interval worker (default 15 min, `RE_FOLLOWUPS_ENABLED`, first run +30s, `timer.unref()`, overlap guard). Candidates: realestate, status active, leadScore warm/hot, no visit/handoff, followups enabled, `sentCount < 2`, updated within 24h, limit 100. **Schedule:** +2h and +20h after last inbound (capped 23h), property-specific copy, persists outbound Message + `flowState.followUps`.

### 3.6 Services — `src/services/`

| File | Exports | Role |
|---|---|---|
| `llm.service.js` (~261) | `callLLM(systemPrompt, recentMessages)`, `getLLMStats()` | **Unified LLM gateway.** Azure OpenAI primary (SDK chat-completions OR raw `fetch` responses-API mode when `AZURE_OPENAI_API_MODE=responses`/endpoint hints), Groq fallback. Token-budget trimming (`LLM_MAX_CONTEXT_TOKENS` default 6000, last 20 msgs), temperature `LLM_TEMPERATURE` default 0.68 (clamped 0–1.2), concurrency semaphore (default 5), 3 retries with exponential backoff, 429 handling. Tracks full stats. |
| `groq.service.js` (~214) | `callGroq(systemPrompt, recentMessages)`, `getGroqStats()` | Multi-key rotation (`GROQ_API_KEYS` comma-separated), round-robin with 60s cooldown on 429, model tiering (`openai/gpt-oss-20b` ≤3 msgs else `openai/gpt-oss-120b`), semaphore (default 5), 3 retries + jitter + `retry-after` respect, `max_tokens: 400`, `temperature: 0.7`. |
| `session.service.js` (~145) | `getSession`, `saveSession`, `clearSession` | Redis-first (`session:<businessId>:<phone>`, TTL 24h); validates conversation still active/handed_off; rebuilds from Mongo (latest Conversation + last 20 Messages) if stale; web sessions use `web:<visitorId>`. Redis failures never crash. |
| `transcription.service.js` (~105) | `transcribeAudio(mediaId, accessToken)` | Downloads audio via Meta Graph API (v21.0), guards (≤25MB), Groq `whisper-large-v3-turbo` (Hindi, response_format text). Returns `__VOICE_TRANSCRIPTION_FAILED__`/`__VOICE_TRANSCRIPTION_EMPTY__` on failure. Never throws. |
| `whatsapp.service.js` (~153) | `sendTextMessage`, `sendImageMessage`, `sendInteractiveButtons`, `markAsRead` | All POST `graph.facebook.com/v21.0/<phoneNumberId>/messages` with Bearer token. Digits-only recipient; resolves localhost media URLs to public base; supports text/image/buttons(≤3)/read receipts. Logs summarized axios errors. |

### 3.7 Routes — `src/routes/`

| File | Guard | Endpoints (prefix) |
|---|---|---|
| `health.routes.js` | public | `GET /health` → `{status:'ok', timestamp, service:'ayka-api'}` |
| `webhook.routes.js` | public | `GET /webhook/whatsapp` + `/webhook` (challenge); `POST /webhook/whatsapp` + `/webhook` (verifyWebhook → resolveTenant → rateLimiter → handler) |
| `auth.routes.js` | public (login) | `POST /api/auth/login` (in-memory rate limit 10/15min per IP; bcrypt compare; returns `{token, user}`), `GET /api/auth/me`, `POST /api/auth/change-password` (min 8 chars, bcrypt 12). `buildAuthUserPayload` enriches client users with `themeConfig` + `businessVertical`. |
| `widget.routes.js` | public (no JWT) | `GET /widget/config/:businessId` (origin allowlist; `business.widget.allowedOrigins`), `POST /widget/init` (returns `v_<32hex>` visitorId + sets HttpOnly cookie `ayka_ws_<businessId>`, 180d, SameSite=None+Secure on HTTPS), `POST /widget/message` (≤2000 chars; in-memory rate limit 20/min; → `processWebMessage`; returns `{response, conversationId, source:'web_widget', sessionMode, timestamp}`). |
| `client.routes.js` (~1048) | JWT + `requireRole('client')` + `enforceBusinessScope` | `/stats`, `/system/runtime-source`, `/charts/lead-volume`, `/charts/score-distribution`, `/charts/funnel`, `/charts/score-over-time`, `/charts/heatmap`, `/activity`, `/leads`, `/leads/:conversationId`, `/conversations`, `/conversations/:id/messages`, `POST /conversations/:id/reply`, `/appointments`, `/properties` CRUD + `POST /properties/media` (multer → `public/uploads/properties/<businessId>`), `/settings`, `POST /flush-kb`, `/export/leads` (streaming CSV). Reply policy: only when handoff triggered AND `dashboardHandoffReplyEnabled !== false`; free within 24h (`REPLY_WINDOW_MS`) of last inbound else requires `allowPaidReplies`. |
| `admin.routes.js` (~696) | JWT + `requireRole('reseller')` + `enforceResellerScope` | `/stats`, `/charts/leads-per-client`, `/charts/portfolio-score`, `/charts/platform-volume`, `/charts/top-clients`, `/charts/monthly-growth`, `/charts/conversion-funnel`, `/charts/message-by-day`, `/clients`, `/clients/:businessId/stats`, `PATCH /clients/:businessId`, `PATCH /clients/:businessId/bot`, `/flush-kb/:businessId`, `/clients/:businessId/widget` GET/PATCH, `/leads`, `/conversations`, `/conversations/:id/messages` (cursor pagination), `/appointments`, `/activity`, `/analytics/score-trend`, `/analytics/avg-score-time`, `/settings` GET/PATCH. |
| `superadmin.routes.js` (~622) | JWT + `requireRole('superadmin')` | `/stats`, `/charts/platform-volume`, `/charts/revenue`, `/charts/reseller-performance`, `/charts/vertical-distribution`, `/charts/system-health` (some simulated data), `/resellers` CRUD (+`/reactivate`), `/clients` CRUD (+`/reactivate`; **encrypts accessToken**; enforces reseller `pricing.botSlots` default 5), `/users` CRUD (+`/reactivate`, optional `newPassword`), `/leads`, `/conversations/:id/messages`, `/system/health`, `/system/runtime-source` (masked Mongo URI), `/system/errors` (stub), `/system/api-usage` (real `getLLMStats()` + Groq token/cost estimates). |

### 3.8 Verticals — `src/verticals/<vertical>/config.js`

| Vertical | Persona | scheduling.enabled | Scoring rules |
|---|---|---|---|
| `school` | Priya (Senior Admissions Counsellor) | **true** — visitHours "9 AM – 2 PM, Mon–Sat", documentsRequired [Aadhaar, birth cert, marksheet, TC, 2 photos] | hot: visitConfirmed/preferredVisitTime/handoff; warm: parent+student+class; else cold. Includes `specialKnowledge.talentHunt2026` event pack. |
| `coaching` | Riya (Course Inquiry Counsellor) | false | hot: demoConfirmed/handoff/courseInterest; warm: name+course+qualification; cold. Handoff triggers include fee negotiation/complaints. |
| `realestate` | Ria (Property Consultant) | false | Budget/timeline parsers (`_parseBudgetLakhs`, `_parseTimelineMonths`); hot: site visit/handoff/matched property OR budget>50L AND timeline≤3mo; warm: partial; cold. Handoff phrases include agent/broker. |

### 3.9 Webhook handler — `src/webhooks/whatsapp.handler.js` (~181 lines)

**Export:** `handleWhatsAppWebhook(req, res)`.
Sends 200 immediately. Handles status updates (persist to Message), webhook dedup (`processed:<id>` 5 min), rate-limit messaging, **BOS bridge** (publishes inbound to Redis `ayka:whatsapp:inbound` for msme tenants in bridge allowlists — env `BOS_BRIDGE_PHONE_NUMBER_IDS`/`BOS_BRIDGE_BUSINESS_IDS` or Redis sets), else calls `processMessage`.

---

## 4. Data Model — `packages/db` (9 Mongoose models)

All models: CommonJS, `{ timestamps: true }`, no methods/statics/virtuals/hooks. **Only `Conversation.contactId` is ever populated** (projections `'name phone'` or `'name phone profile'`).

### `Business` (`businesses`) — the tenant
| Field | Notes |
|---|---|
| `resellerId` | ref Reseller, default null (direct clients allowed) |
| `name`, `slug` | required; slug unique |
| `vertical` | enum `['school','realestate','healthcare','msme','coaching']` |
| `pricing` | subdoc `{ totalPrice, note }` (direct clients) |
| `whatsapp` | subdoc `{ phoneNumberId (unique), accessToken, wabaId, verifyToken }` |
| `settings` | `{ displayName, agentName, timezone='Asia/Kolkata', language='en', handoffPhone, dashboardHandoffReplyEnabled=true, allowPaidReplies=false }` |
| `subscription` | `{ plan='basic', status='active', expiresAt }` |
| `widget` | `{ enabled=false, position, welcomeMessage, placeholder, agentName, agentAvatar, brandName, theme{primaryColor, headerBg, headerText, chatBg, userBubble, userText, botBubble, botText, fontFamily, borderRadius, buttonSize}, allowedOrigins[], collectName=true, collectEmail=false, collectPhone=false, poweredBy=true }` |
| `isActive` | default true |
| Indexes | `whatsapp.phoneNumberId` unique, `resellerId` |

### `Conversation` (`conversations`) — the central pipeline entity
`businessId` (req), `resellerId`, `contactId` (req), `phone` (req), `status` enum `[active, handed_off, resolved, expired]`, `vertical` (req), **`flowState`** (`goals` booleans: inquiryUnderstood, parentNameCollected, studentInfoCollected, infoShared, visitSuggested, contactDetailsCollected; `collectedData` dual-vertical: parentName/buyerName, studentName, interestedClass, preferredVisitTime, altPhone, propertyType, listingType, bhk, budget, locationPreference, timeline, purpose, propertyId, propertyMediaOffset, propertyMediaPropertyId; `handoffTriggered/handoffAt`, `visitConfirmed/visitConfirmedAt`, `followUps{sentCount,lastSentAt,disabled}`, `sentiment`), **`source`** (`{sourceType, ctwaClid, adId, adHeadline}` — CTWA/ad attribution), `openedAt`, `resolvedAt`, **`leadScore`** enum `[hot,warm,cold]` default cold + `leadScoreReason` + `leadScoreUpdatedAt`.
Indexes: `{businessId,status}`, `{businessId,phone,status}`, `{businessId,contactId}`, `{contactId,openedAt:-1}`, `{businessId,leadScore,openedAt:-1}`.

### `Message` (`messages`)
`conversationId`/`businessId`/`contactId` (req), `direction` enum `[inbound,outbound]`, `role` enum `[user,assistant]`, `content` subdoc `{contentType: [text,image,video,document], text, url, caption, mediaType, fileName}`, `waMessageId` (unique sparse — dedup), `status` enum `[sent,delivered,read,failed]`, `timestamp`.
Indexes: `{conversationId,timestamp}`, `{businessId,createdAt:-1}`, `waMessageId` unique sparse.

### `Contact` (`contacts`) — lead identity
`businessId` (req), `resellerId`, `phone`, `name`, `email`, `webVisitorId`, `source` enum `[whatsapp, web_widget, manual]`, `profile` subdoc `{studentName, interestedClass, altPhone, email}`, `tags[]`, `optedIn=true`, `firstContactAt`, `lastMessageAt`, `totalConversations`.
Indexes: `{businessId,phone}` unique with partial filter (phone is string — allows null-phone web visitors), `{businessId,webVisitorId}` sparse, `{resellerId,lastMessageAt:-1}`.

### `Appointment` (`appointments`) — visit bookings
`businessId`/`resellerId`/`conversationId` (req, unique)/`contactId` (req)/`phone` (req), `parentName`, `studentName`, `interestedClass`, `scheduledDate` (NL string like "tomorrow"), `scheduledTime` (NL), `rawPreference` (original text), `status` enum `[confirmed,cancelled,completed,no_show]`, `staffNotified`/`staffNotifiedAt`, `documentsAdvised[]`.
Indexes: `{businessId,status,createdAt:-1}`, `conversationId` **unique** (one active appointment per conversation; rescheduling cancels old).

### `KnowledgeBase` (`knowledgebases`) — bot grounding
`businessId` (req, **unique**), `resellerId` (req), `vertical` (req), **`content` = `Schema.Types.Mixed`** (free-form JSON: school facts, fees, hostel, transport, FAQ, etc.), `version=1`, `isActive=true`.

### `Property` (`properties`) — real-estate listings
`businessId` (req), `resellerId`, `title` (req, trimmed), `slug`, `status` enum `[available,hold,sold,rented,inactive]`, `listingType` enum `[sale,rent,lease]`, `propertyType` enum `[apartment,villa,plot,floor,commercial,office,shop,farmhouse,other]`, `bhk`, `carpetArea`, `builtUpArea`, `areaUnit` enum `[sqft,sqyd,sqm,acre,bigha]`, `price`, `priceLabel`, `maintenance`, `negotiable`, `location` subdoc `{city, locality, address, landmark, mapUrl}`, `possession`, `furnishing` enum `['',unfurnished,semi-furnished,fully-furnished]`, `facing`, `floor`, `amenities[]`, `highlights[]`, `description`, `media[]` (subdocs `_id:false` `{type: [image,video], url (req), caption}`), `contactPhone`, `isFeatured`, `priority`.
Indexes: `{businessId,status,priority:-1,updatedAt:-1}`, `{businessId,location}`, `{businessId,propertyType,listingType}`.

### `Reseller` (`resellers`) — channel partner
`name`, `slug` (unique), `email`, `phone`, `pricing` subdoc `{setupCost, perBotCost, monthlyPerBot, botSlots=5}`, `platformFeeStatus` enum `[paid,overdue,trial]`, **`themeConfig`** (white-label: brandName, logoUrl, colors, faviconUrl, supportEmail/Phone, showPlatformCredit, `features` subdoc with 8 booleans all default true: showAppointments, showAnalytics, showExport, showLeadScore, showConversations, showActivityFeed, showStaffNotifications, showBotStatus), `isActive`.

### `User` (`users`) — dashboard accounts
`email` (req, unique, lowercase), `passwordHash` (req, **`select:false`** — must `.select('+passwordHash')`), `role` enum `[superadmin, reseller, client]`, `businessId` (client), `resellerId` (reseller), `displayName` (req), `themeConfig` (same shape as Reseller's, different default dark palette: primary `#6C47FF`, background `#0f0f13`), `lastLoginAt`, `isActive`.
⚠️ **No pre-save hash hook** — hashing is done in routes/scripts (`bcrypt.hash(..., 10|12)`).

### Relationship map
```
Reseller ──1:N──▶ Business ──1:N──▶ Contact ──1:N──▶ Conversation ──1:N──▶ Message
   ▲                 │                 │                │  │
   │                 ├──▶ KnowledgeBase│                │  └──▶ Appointment (1:1 unique per conversation)
   │                 ├──▶ Property     │                └──▶ (leadScore, flowState)
   │                 └──▶ User (client)│
   └──▶ User (reseller)
```

`@ayka/shared` is an **empty placeholder** (0-byte `index.js`, zero consumers).

---

## 5. Frontend — `apps/dashboard` (Next.js 14, App Router, port 3001)

### 5.1 Core libs/components/hooks

| File | Exports | Role |
|---|---|---|
| `lib/api.js` | `apiFetch`, `getToken`, `setToken`, `removeToken`, `getUser`, `setUser`, `API_URL` | Central HTTP client. Injects `Content-Type` + `Authorization: Bearer <token>`; on 401 → clear + redirect `/login`; returns raw `Response` for CSV. Token in localStorage `ayka_token`, user in `ayka_user`. URL resolution: `NEXT_PUBLIC_API_URL` → else localhost:3000 → else same-origin. **CommonJS `module.exports` (required via `require`).** |
| `lib/format.js` | `formatNumber`, `relativeTime`, `formatDate`, `formatAppointmentPreference`, `dateSeparator`, `truncate`, `deltaInfo` | Indian number formatting, relative times, date pills, delta arrows (ESM exports). |
| `hooks/useFetch.js` | `useFetch(url, deps=[])` | `{ data, loading, error, refetch }`; refetch on url/deps change; aborts on `url===null`. No SWR/React Query. |
| `components/UI.js` | `StatCard`, `Badge`, `SlideOver`, `ChartWrapper`, `DataTable`, `TopBar`, `Modal`, `ConfirmDialog`, `FormField`, `FormInput`, `FormSelect` | Reusable dark-theme UI kit. `Badge` color map: hot=red, warm=amber, cold/gray, confirmed/completed/active=green, cancelled/error=red, no_show/pending/paused=amber. `DataTable` uses `data` prop (⚠️ some pages pass `rows`). |
| `components/DashboardLayout.js` | default `DashboardLayout({children, requiredRole})` | Enforces auth + role; injects CSS vars from `user.themeConfig` (primaryColor→`--color-primary`, etc.); sets `document.title` + favicon; renders Sidebar + main. |
| `components/Sidebar.js` | default `Sidebar()` | Role-aware nav (desktop sidebar + mobile bottom tab bar). Client nav: Dashboard/Leads/Conversations/Appointments/Settings (+Properties for real-estate clients or `businessId === '6a3157f348f8877f957279bd'`). Reseller nav adds Analytics, Web Widget. Superadmin nav: Dashboard/Resellers/Clients/Users/Leads/System/Settings. Calls `GET /api/auth/me` on mount to refresh theme. Footer "Powered by Welltechup x Ayka". |

### 5.2 Pages by role

**Auth:** `/login` — POST `/api/auth/login`, role-based redirect. Demo creds (in code): superadmin `superadmin@ayka.in`/`AyKaSuperAdmin2026!`, reseller `admin@welltechup.com`/`WellTechUp2026!`, client `admin@santpathik.in`/`SPV2026!`.

**Client (`/client/*`):**
- `dashboard` — 4 StatCards with deltas; Lead Volume line (current vs previous), Score Distribution donut, Conversion Funnel, Score-over-time stacked bars, 7×24 **Conversation Heatmap** (IST), Recent Activity, Recent Hot Leads.
- `leads` — DataTable + filters + CSV export (`/export/leads`, raw fetch, blob download), detail SlideOver with flowState + appointment.
- `conversations` — inbox with **reply composer** (policy-gated: feature_disabled / handoff_required / outside_24h_window / no_inbound_message), image/video message rendering, date separators, load-earlier pagination.
- `appointments` — list + **calendar month view** (status-colored chips).
- `properties` (real-estate only) — full CRUD: table, add/edit SlideOver (price formatting ₹ Crore/Lakh, media uploader with multer, "Add more details" collapsible), status filter, debounced search.
- `settings` — read-only school/bot info + change password.

**Reseller/admin (`/admin/*`):**
- `dashboard` — 6 StatCards (incl. Bot Uptime 99.9% hardcoded), 7+ charts, Recent Activity, Client Health table.
- `analytics` — score trend, avg time to score, funnel, message-by-day, monthly growth, top clients.
- `appointments` — cross-client list + SlideOver detail, client filter.
- `clients` — list + scoped stats (4 StatCards) + edit settings SlideOver + **pause/resume bot**.
- `conversations` — read-only transcript viewer (no composer).
- `leads` — paginated/filterable table + Lead Profile SlideOver.
- `settings` — reseller profile, **white-label Theme Configuration** (color pickers, live re-inject), change password.
- `widget` — per-client widget config editor with **LIVE PREVIEW** (theme colors, collect fields, allowedOrigins, position) — embed code deliberately not shown here (superadmin only).

**Superadmin (`/superadmin/*`):**
- `dashboard` — 8 StatCards, Platform Volume, Revenue by Reseller, Reseller Performance, Vertical Distribution, System Health (simulated), Reseller Health table.
- `clients` — full CRUD incl. WhatsApp config (raw tokens visible), **widget embed code + Copy Code** (the only place it's exposed), reactivate.
- `resellers` — CRUD + pricing + white-label theme + fee status + deactivate (cascades to clients/users).
- `users` — CRUD + password reset + role assignment with conditional reseller/client selects.
- `leads` — cross-platform table.
- `system` — 3 tabs: Health (DB counts, uptime, memory), Errors (stub), API Usage (real LLM/Groq stats + cost estimates).
- `settings` — static platform info + change password.

### 5.3 Widget — `apps/widget`

- `dist/ayka-widget.js` (~450 lines IIFE) — the shipped embeddable runtime (source not in repo). Reads its own script tag `data-business-id` + `data-api-url`; calls `/widget/config`, `/widget/init`, `/widget/message`; persists visitorId/messages/visitor-info in localStorage; renders themed floating button + chat panel; info-collection form; optimistic send + retry; typing indicator; HTML escaping.
- `demo.html` — marketing/embed demo for "Sant Pathik Vidyalaya, Bahraich" embedding the widget with businessId `69a305f398f94563b73c6ef3`.
- Canonical embed snippet:
  ```html
  <script src="https://your-api.ayka.in/widget/embed/ayka-widget.js"
          data-business-id="YOUR_BUSINESS_ID"
          data-api-url="https://your-api.ayka.in"></script>
  ```

### 5.4 Known frontend issues (for agents to be aware of)

- `DataTable` expects prop `data`, but `admin/leads` and `superadmin/leads` pass `rows` → those tables may render incorrectly.
- `js-cookie` and `date-fns` are declared but unused.
- Window-width responsive logic evaluated at render (not reactive).

---

## 6. Scripts — `apps/api/scripts/` (28 files)

> Most require `MONGODB_URI` (from `.env` / `.env.production`). Only `seed:buildsworth` and `switch:demo-phone` are wired into `package.json`. Env tokens are encrypted with AES-256-GCM before storage.

**Seeding / onboarding:**
- `seed-dashboard.js` — creates WellTechUp reseller + 3 demo users (superadmin/reseller/client) with themes; ensures SPV business. Optionally random passwords (printed).
- `seed-spv.js` — production onboarding of **Sant Pathik Vidyalaya** (school, Hindi). Handles phone-number unique-index conflict by archiving duplicates.
- `seed-buildsworth.js` — **Buildsworth CADD Centre** demo (coaching, agent "Riya", KB with courses/departments).
- `seed-iap.js` — **IAP Professional** (coaching, agent "Riya", Hindi, 3 AI courses, 18-item bilingual FAQ).
- `seed-realestate-demo.js` — **AyKa Realty Demo** (realestate, agent "Ria", 6 property listings, custom widget theme).
- `seed-ssew-business.js` — **S.S. Engineering Works** MSME business for the BOS inbound pipeline (agent "AyKa BOS").
- `switch-demo-phone.js` — moves one shared Meta test phone between SPV/Buildsworth/Realty; validates token via Graph debug_token; moves conflicts to deterministic offline placeholders; clears tenant cache.

**Knowledge Base (SPV school):**
- `update-kb.js` → `update-kb-comprehensive.js` (cross-referenced against 19 source PDFs, ~60 `$set` fields) → `update-kb-parent-faqs.js` (30-item bilingual FAQ, QR payment, 42 bus stops, hostel checklists/installment plans, uniform vendor "Agarwal Gift Gallery 9792641527") → `create-spv-kb.js` (clone + hostel + feeSimplified). All clear the `kb:<businessId>` Redis cache.
- `dump-kb.js` / `dump-existing-kb.js` / `inspect-db.js` — read-only KB/business diagnostics.

**Testing / validation (no DB writes):**
- `test-scoring.js` (~34 assertions, exits 1 on fail), `test-scheduling.js` (24+ assertions on VISIT_CONFIRMED parsing/scoring/prompt), `redteam.js` (~90 adversarial extraction test cases), `simulate-bahraich.js` / `simulate-bahraich-quick.js` (live Groq calls against real KB, prints full system prompt + responses).
- `e2e-check.js` / `e2e-full.js` — smoke/E2E suites against running API (:3000) + dashboard (:3001); require `E2E_SUPERADMIN_PASSWORD`, `E2E_RESELLER_PASSWORD`, `E2E_CLIENT_PASSWORD`.

**Ops / misc:**
- `backfill-lead-scores.js` — recompute `leadScore` for all conversations (idempotent, batched bulkWrite).
- `clear-redis.js`, `clear-sessions.js`, `reset-session.js` — ⚠️ **stale**: target Upstash REST (`Redis.fromEnv()`), but production now uses self-hosted ioredis; `@upstash/redis` not in deps.
- `fix-spv-token.js`, `_encrypt-token-once.js` — one-off token rotation/encryption helpers.
- `test-mongo.js` — connectivity check.

---

## 7. Environment Variables (complete catalog)

**Required (validated at boot):** `MONGODB_URI`, `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN` (comma-separated), `ENCRYPTION_KEY` (64-hex), `NODE_ENV`, `JWT_SECRET`, `AZURE_OPENAI_KEY` or `AZURE_OPENAI_API_KEY`.

**LLM:** `AZURE_OPENAI_DEPLOYMENT` (default `gpt-4.1-mini`), `AZURE_OPENAI_ENDPOINT`, `AZURE_OPENAI_API_VERSION`, `AZURE_OPENAI_API_MODE` (`responses`), `LLM_MAX_CONCURRENCY` (5), `LLM_MAX_CONTEXT_TOKENS` (6000), `LLM_TEMPERATURE` (0.68), `GROQ_API_KEYS`/`GROQ_API_KEY`, `GROQ_MODEL_FAST` (`openai/gpt-oss-20b`), `GROQ_MODEL_DEFAULT` (`openai/gpt-oss-120b`).

**Redis:** `REDIS_URL`, `REDIS_PASSWORD`. Channels: `ayka:whatsapp:outbound`, `ayka:whatsapp:inbound`; bridge sets `ayka:whatsapp:bridge:*`.

**WhatsApp/Meta:** `META_APP_SECRET`, `META_WEBHOOK_VERIFY_TOKEN`, `SKIP_META_SIGNATURE_VERIFY`, `WHATSAPP_MEDIA_BASE_URL`/`API_PUBLIC_URL`/`PUBLIC_API_URL`/`API_URL`, `BOS_BRIDGE_PHONE_NUMBER_IDS`, `BOS_BRIDGE_BUSINESS_IDS`, `BOS_WHATSAPP_INBOUND_URL`, `BOS_WHATSAPP_INBOUND_SECRET`.

**Behavior:** `PROCESS_LOCK_TTL_SECONDS` (45), `PROPERTY_IMAGE_BATCH_SIZE` (8), `PROPERTY_IMAGE_MAX_SEND` (30), `RE_FOLLOWUPS_ENABLED`, `RE_FOLLOWUP_INTERVAL_MS` (15 min).

**Widget/CORS:** `WIDGET_SESSION_SECRET`, `CORS_ALLOW_ALL`, `ALLOWED_ORIGINS`.

**Server:** `PORT` (3000), `LOG_LEVEL`.

**Script-only:** `WA_ACCESS_TOKEN`, `WA_PHONE_NUMBER_ID`, `WA_WABA_ID`, `SEED_*`, `RE_DEMO_*`, `SPV_*`, `IAP_*`, `BUILDSWORTH_*`, `SSEW_WA_*`, `DEMO_SLUG`/`DEMO_TENANT`, `E2E_*_PASSWORD`, `SCHOOL_QR_IMAGE_URL`, `SPV_QR_IMAGE_URL`.

---

## 8. Infrastructure & Deployment

### Docker
- `infra/docker/Dockerfile` (API): two-stage `node:20-alpine`; copies all workspace package.json files (deliberately `npm install --ignore-scripts --omit=dev`, not `npm ci` due to lockfile drift); runs `node index.js` from `/app/apps/api`.
- `infra/docker/Dockerfile.dashboard`: builds Next.js standalone (`output:'standalone'`), build arg `NEXT_PUBLIC_API_URL`, serves `.next/standalone` server on port 3001.
- `docker-compose.yml`: `api` (3000:3000, env_file `.env.production`, volume `./apps/api/public/uploads`, /health healthcheck) + `dashboard` (3001:3001, build arg default `https://api.ayka.site`, depends_on healthy api).
- `.dockerignore` excludes node_modules/.next/.env/git/services/SPV/docs/*.md and `apps/widget` (except package.json).

### CI/CD (`.github/workflows/`)
- `deploy.yml` — on push to master touching `apps/api/**`, `packages/db/**`, or `infra/docker/Dockerfile`: build+push `aykaregistry.azurecr.io/ayka-api:<sha>`, deploy to Azure Container App `ayka-api` in rg `ayka-rg`.
- `deploy-dashboard.yml` — on push touching `apps/dashboard/**`, `packages/shared/**`, or `infra/docker/Dockerfile.dashboard`: build+push `ayka-dashboard:<sha>` (build arg `NEXT_PUBLIC_API_URL=https://api.ayka.site`), create-or-update Container App `ayka-dashboard` (0–2 replicas, 0.5 CPU/1Gi, port 3001).

### Docs
- `docs/OPERATIONS.md` (1,149 lines) — complete ops guide: architecture, local dev, Azure deployment (Azure for Students credit, rg `ayka-rg`, Container Apps), domain/DNS, Meta WhatsApp integration, onboarding runbooks (client/reseller/superadmin), widget setup, KB management, LLM config/monitoring, DB queries, troubleshooting, security checklist, backup/recovery, plus an "AyKa BOS" appendix on per-tenant encrypted credentials.
- `docs/azure-optimization-report.md` — Azure cost/credit analysis (~$32.70/mo, $990 credit).
- `docs/devlog/` — TEMPLATE.md + one entry (2026-04-24).
- `CODEBASE_MEMORY.md` (4,865 lines) — prior auto-generated per-file memory dump (2026-03-26). **Significantly stale**: predates `followup.engine.js`, `seed-buildsworth.js`, `seed-realestate-demo.js`, `seed-ssew-business.js`, `switch-demo-phone.js`, `nodemon.json`, and the recent conversation/flow/prompt changes. Use as historical context only.

---

## 9. Security Model (as built)

- **WhatsApp tokens** encrypted at rest (AES-256-GCM, `iv:tag:ct`) and decrypted only at send time.
- **JWT** auth (7-day), RBAC (`requireRole`), scope enforcement (`enforceBusinessScope`/`enforceResellerScope`), dual enforcement in UI + API.
- **Login rate limiting** (in-memory 10/15min/IP); **widget rate limiting** (20/min/visitor); **webhook rate limiting** (Redis, 20 msg/60s).
- **Webhook HMAC** signature verification (timing-safe).
- **Dedup** at webhook + message level (Redis), process locks prevent concurrent processing.
- **CORS** allowlist for private endpoints; public widget endpoints gate by origin allowlist + widget.enabled + active business.
- **Prompt injection defense** in `prompt.builder` (marker/jailbreak stripping); **phone normalization**; secrets redacted in logs.
- ⚠️ Notable gaps (from OPERATIONS.md): JWT_SECRET rotation pending, dashboard IP allowlist pending, Mongo audit logging pending, HTTPS-only cookie pending. `create-spv-kb.js` contains a malformed hard-coded `resellerId`; some superadmin dashboard charts use simulated data.

---

## 10. API Endpoint Catalog (summary)

| Method | Path | Role |
|---|---|---|
| GET | `/health` | public |
| GET/POST | `/webhook/whatsapp`, `/webhook` | public (Meta) |
| POST | `/api/auth/login`, `GET /api/auth/me`, `POST /api/auth/change-password` | public / any authenticated |
| GET | `/widget/config/:businessId`, `POST /widget/init`, `POST /widget/message`, `GET /widget/embed/ayka-widget.js` | public widget |
| GET/POST/PATCH/DELETE | `/api/client/...` (stats, charts, activity, leads, conversations+reply, appointments, properties+media, settings, export/leads) | client |
| GET/PATCH | `/api/admin/...` (stats, charts, clients+bot+widget, leads, conversations, appointments, activity, analytics, settings, flush-kb) | reseller |
| GET/POST/PATCH/DELETE | `/api/superadmin/...` (stats, charts, resellers, clients, users, leads, system/*) | superadmin |

---

## 11. Key Conventions & Gotchas for Agents

1. **CommonJS throughout** the API and `packages/db`; the dashboard mixes `require('lib/api')` into ESM pages.
2. **Redis wrapper** (`src/config/redis.js`) emulates Upstash REST semantics — treat `redis.set(key, val, { ex })` and `pipeline()` as the canonical API; use `_client` only when needed.
3. **Sessions** live in Redis and are rebuilt from Mongo; **KB** is Redis-cached 1h — always clear `kb:<businessId>` after KB edits (scripts do this).
4. **`Conversation.flowState.collectedData` is dual-vertical** (school + real-estate fields coexist); engines write whichever applies.
5. **`leadScore` lives on Conversation** (not Contact); only the latest score is stored.
6. **Appointments are 1:1 per conversation** (unique index) — rescheduling cancels the old row.
7. **`@ayka/shared` is dead** (empty); enums are duplicated inline across files.
8. **Widget bundle is prebuilt** (`dist/ayka-widget.js`); its source isn't in the repo — rebuilds must happen elsewhere.
9. **Two Redis tooling models**: live code uses ioredis; three old scripts still reference Upstash and will not run against current infra.
10. **No test framework** — "tests" are standalone Node scripts with assertion helpers (`test-scoring.js`, `test-scheduling.js`, `redteam.js`); no lint/typecheck commands are configured.
11. **Demo/seed tenants:** SPV (`69a305f398f94563b73c6ef3`), test school (`699c2d8d78317f50e82efa62`), Buildsworth, IAP Professional, AyKa Realty (`6a3157f348f8877f957279bd` — the real-estate demo business id also triggers the Properties nav item).
