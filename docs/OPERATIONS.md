# AyKa AI Platform — Complete Operations Guide

> **Version:** 1.0 | **Last Updated:** 1 March 2026  
> **Platform:** api.ayka.site | dashboard.ayka.site

---

## Table of Contents

1. [Architecture Overview](#1-architecture-overview)
2. [Local Development](#2-local-development)
3. [Azure Deployment](#3-azure-deployment)
4. [Domain & DNS Setup](#4-domain--dns-setup)
5. [WhatsApp Meta Integration](#5-whatsapp-meta-integration)
6. [Client Onboarding — Step by Step](#6-client-onboarding--step-by-step)
7. [Reseller Onboarding — Step by Step](#7-reseller-onboarding--step-by-step)
8. [Superadmin Operations Guide](#8-superadmin-operations-guide)
9. [Reseller Operations Guide](#9-reseller-operations-guide)
10. [Client Operations Guide](#10-client-operations-guide)
11. [Web Widget Setup Guide](#11-web-widget-setup-guide)
12. [Knowledge Base Management](#12-knowledge-base-management)
13. [LLM Configuration & Monitoring](#13-llm-configuration--monitoring)
14. [Database Management](#14-database-management)
15. [Monitoring & Troubleshooting](#15-monitoring--troubleshooting)
16. [Security Checklist](#16-security-checklist)
17. [Backup & Recovery](#17-backup--recovery)

---

## 1. Architecture Overview

```
┌──────────────────────────────────────────────────────────┐
│                    Internet / Users                       │
├──────────┬──────────────┬──────────┬─────────────────────┤
│ WhatsApp │  Web Widget   │Dashboard │  Meta Webhook       │
│ Users    │  (any site)   │ (Next.js)│  Callbacks          │
└────┬─────┴──────┬────────┴────┬─────┴──────┬──────────────┘
     │            │             │            │
     ▼            ▼             ▼            ▼
┌──────────────────────────────────────────────────────────┐
│              api.ayka.site (Express.js)                   │
│  Port 3000 — Azure Container Apps                        │
├──────────────────────────────────────────────────────────┤
│ Routes:                                                   │
│  /webhook/whatsapp  — Meta webhook handler                │
│  /widget/*          — Web widget public API               │
│  /api/auth/*        — Login, JWT tokens                   │
│  /api/client/*      — Client dashboard API (12 endpoints) │
│  /api/admin/*       — Reseller dashboard API (25 endpoints│
│  /api/superadmin/*  — Platform admin API (20 endpoints)   │
├──────────────────────────────────────────────────────────┤
│ Core Engines:                                             │
│  conversation.engine   — WhatsApp message pipeline        │
│  web.conversation.engine — Web widget pipeline            │
│  flow.engine           — Goal tracking & data extraction  │
│  scoring.engine        — Lead scoring (hot/warm/cold)     │
│  scheduling.engine     — Visit appointment scheduling     │
│  handoff.engine        — Human handoff notifications      │
│  prompt.builder        — Context-aware system prompts     │
├──────────────────────────────────────────────────────────┤
│ LLM: Groq (primary) → Azure OpenAI (fallback)            │
│  Multi-key rotation, concurrency limiter, model tiering   │
└──────────┬───────────────────────────┬───────────────────┘
           │                           │
           ▼                           ▼
┌──────────────────┐    ┌──────────────────────┐
│ MongoDB (Azure VM)│    │ Redis (Azure VM)      │
│ 20.235.104.28     │    │ Session cache, KB cache│
│ 8 collections     │    │ Rate limit state       │
└──────────────────┘    └──────────────────────┘
```

### Collections
| Collection | Purpose | Key Fields |
|---|---|---|
| businesses | Client organizations | name, slug, vertical, whatsapp config, widget config |
| resellers | Partner organizations | name, plan, pricing, themeConfig |
| users | Dashboard login accounts | email, role (superadmin/reseller/client), businessId/resellerId |
| conversations | Chat sessions | businessId, contactId, leadScore, flowState, source |
| messages | Individual messages | conversationId, direction, content, waMessageId |
| contacts | Customer profiles | phone, webVisitorId, source, totalConversations |
| knowledgebases | Business knowledge | businessId, content (about, academics, fees, etc.) |
| appointments | Scheduled visits | businessId, contactId, date, status |

### Dashboard Roles
| Role | URL Path | Access |
|---|---|---|
| **superadmin** | /superadmin/* | Full platform: resellers, clients, users, system health, all leads |
| **reseller** | /admin/* | Own portfolio: clients, leads, conversations, appointments, analytics, widget config |
| **client** | /client/* | Own business: dashboard, leads, conversations, appointments, settings |

---

## 2. Local Development

### Prerequisites
- Node.js 20+ (via nvm)
- Access to MongoDB on Azure VM (`20.235.104.28:27017`)
- Groq API key(s)

### Start API Server
```bash
# Load nvm
source $HOME/.nvm/nvm.sh

# Navigate to API
cd /home/rudra/Ayka/ayka/apps/api

# Install dependencies (from monorepo root)
cd /home/rudra/Ayka/ayka && npm install

# Start API (foreground)
cd apps/api && node index.js

# OR start API (background, logs to file)
cd apps/api && nohup node index.js > /tmp/api.log 2>&1 &

# Verify
curl http://localhost:3000/health
# Expected: {"status":"ok","timestamp":"...","service":"ayka-api"}
```

### Start Dashboard
```bash
source $HOME/.nvm/nvm.sh
cd /home/rudra/Ayka/ayka/apps/dashboard

# Install dependencies (if not already)
npm install

# Start dev server
npx next dev -p 3001

# OR background
nohup npx next dev -p 3001 > /tmp/dashboard.log 2>&1 &

# Access: http://localhost:3001
```

### Build Dashboard for Production
```bash
source $HOME/.nvm/nvm.sh
cd /home/rudra/Ayka/ayka/apps/dashboard
NEXT_PUBLIC_API_URL=https://api.ayka.site npx next build
```

### Stop Services
```bash
# Kill API on port 3000
kill $(lsof -t -i:3000) 2>/dev/null

# Kill Dashboard on port 3001
kill $(lsof -t -i:3001) 2>/dev/null
```

### Test Login Credentials
| Role | Email | Password |
|---|---|---|
| Superadmin | superadmin@ayka.in | AyKaSuperAdmin2026! |
| Reseller (WellTechUp) | admin@welltechup.com | WellTechUp2026! |
| Client (Sant Pathik) | admin@santpathik.in | SPV2026! |

---

## 3. Azure Deployment

### Current Azure Resources
- **Subscription:** Azure for Students ($1,000 credit, expires May 16, 2026)
- **Resource Group:** ayka-rg (Central India)
- **Container Apps Environment:** ayka-env
- **Container Registry:** aykacr.azurecr.io
- **Current API URL:** ayka-api.wonderfulisland-7d20e685.centralindia.azurecontainerapps.io

### Build & Push Docker Image
```bash
# Login to Azure
az login

# Login to Container Registry
az acr login --name aykacr

# Build the image
cd /home/rudra/Ayka/ayka
docker build -t aykacr.azurecr.io/ayka-api:latest -f infra/docker/Dockerfile .

# Push to registry
docker push aykacr.azurecr.io/ayka-api:latest
```

### Deploy to Container Apps
```bash
# Update the container app with new image
az containerapp update \
  --name ayka-api \
  --resource-group ayka-rg \
  --image aykacr.azurecr.io/ayka-api:latest

# Check deployment status
az containerapp show \
  --name ayka-api \
  --resource-group ayka-rg \
  --query "properties.runningStatus"

# View logs
az containerapp logs show \
  --name ayka-api \
  --resource-group ayka-rg \
  --follow

# Check revision status
az containerapp revision list \
  --name ayka-api \
  --resource-group ayka-rg \
  --output table
```

### Set Environment Variables on Azure
```bash
# Set all env vars (run once, update as needed)
az containerapp update \
  --name ayka-api \
  --resource-group ayka-rg \
  --set-env-vars \
    NODE_ENV=production \
    PORT=3000 \
    MONGODB_URI="mongodb://aykaadmin:AykaDB2026@20.235.104.28:27017/ayka?authSource=admin" \
    REDIS_URL="redis://20.235.104.28:6379" \
    REDIS_PASSWORD="AykaRedis@2026!" \
    GROQ_API_KEYS="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" \
    GROQ_MODEL_FAST="llama-3.1-8b-instant" \
    GROQ_MODEL_DEFAULT="llama-3.3-70b-versatile" \
    LLM_MAX_CONCURRENCY=5 \
    JWT_SECRET="a4f9e2c17d3b8a6e5f0c1d9b2e7a4f6c8d3b1e5a9f2c7d4b6e8a1c3f5d7b9e2a4c6f8d1b3e5a7c9f2d4b6e8a1c3f5" \
    ENCRYPTION_KEY="c7ff000224dc186ad77ae46b24f96e897a8b8e6312f82a03c1c6f220877ee564" \
    META_APP_SECRET="b2b942f4ee5c5726bf0ccbb2741288c7" \
    META_WEBHOOK_VERIFY_TOKEN="spv_webhook_secret_2026"
```

### Scale Configuration
```bash
# Set min/max replicas (0 = scale to zero when idle, saves cost)
az containerapp update \
  --name ayka-api \
  --resource-group ayka-rg \
  --min-replicas 0 \
  --max-replicas 3 \
  --cpu 0.5 \
  --memory 1.0Gi

# Check current scale
az containerapp show \
  --name ayka-api \
  --resource-group ayka-rg \
  --query "properties.template.scale" \
  --output json
```

### Deploy Dashboard (Static Web Apps)
```bash
# Option 1: Azure Static Web Apps (recommended, free tier)
cd /home/rudra/Ayka/ayka/apps/dashboard
NEXT_PUBLIC_API_URL=https://api.ayka.site npx next build

# Create Static Web App
az staticwebapp create \
  --name ayka-dashboard \
  --resource-group ayka-rg \
  --location centralindia \
  --sku Free

# Option 2: Deploy dashboard as another Container App
# Build dashboard Docker image and push to ACR
```

---

## 4. Domain & DNS Setup

### Subdomains Required
| Subdomain | Points To | Purpose |
|---|---|---|
| api.ayka.site | Azure Container App (ayka-api) | Backend API |
| dashboard.ayka.site | Azure Static Web App or Vercel | Dashboard |
| ayka.site | Landing page | Marketing site |

### Azure Container Apps Custom Domain
```bash
# 1. Add custom domain to container app
az containerapp hostname add \
  --name ayka-api \
  --resource-group ayka-rg \
  --hostname api.ayka.site

# 2. Get the TXT validation record
az containerapp hostname list \
  --name ayka-api \
  --resource-group ayka-rg \
  --output table

# 3. Add DNS records at your domain registrar:
#    Type: CNAME
#    Name: api
#    Value: ayka-api.wonderfulisland-7d20e685.centralindia.azurecontainerapps.io
#
#    Type: TXT
#    Name: asuid.api
#    Value: <validation-token-from-step-2>

# 4. Bind the managed certificate (free SSL)
az containerapp hostname bind \
  --name ayka-api \
  --resource-group ayka-rg \
  --hostname api.ayka.site \
  --environment ayka-env \
  --validation-method CNAME
```

---

## 5. WhatsApp Meta Integration

### Current Configuration
- **Meta App Secret:** 6946848ce306e12cd9637be2c2ca7080
- **Webhook Verify Token:** spv_webhook_secret_2026
- **Webhook URL:** https://api.ayka.site/webhook/whatsapp

### Setup New WhatsApp Business Account for a Client

1. **Go to Meta Business Suite** → https://business.facebook.com
2. **Create WhatsApp Business Account** (WABA) or use existing
3. **Add Phone Number** and verify it via SMS/call
4. **Go to App Dashboard** → https://developers.facebook.com
5. **Select your app** → WhatsApp → Configuration
6. **Copy these values:**
   - Phone Number ID (e.g., `123456789012345`)
   - WhatsApp Business Account ID (WABA ID)
   - Generate a **permanent access token** (System User → Generate Token → whatsapp_business_messaging, whatsapp_business_management)
7. **Set Webhook URL:**
   - Callback URL: `https://api.ayka.site/webhook/whatsapp`
  - Verify Token: `spv_webhook_secret_2026`
   - Subscribe to: `messages`, `message_status`

### ⚠️ Important Notes
- Each client business needs its OWN Phone Number ID and access token
- Access tokens are encrypted at rest in MongoDB (AES-256)
- The webhook URL is shared — all clients use the same endpoint
- The `resolveTenant` middleware routes messages to the correct business by Phone Number ID

---

## 6. Client Onboarding — Step by Step

### Prerequisites
- [ ] Client's business name and vertical (school/realestate)
- [ ] WhatsApp Business Phone Number ID
- [ ] WhatsApp Access Token (from Meta Business Suite)
- [ ] WABA ID
- [ ] Client's admin email for dashboard login
- [ ] Knowledge base content (school info, fees, facilities, etc.)
- [ ] (Optional) Reseller ID if client belongs to a reseller

### Step 1: Create the Client Business (via Dashboard)

1. Login to dashboard as **superadmin** (superadmin@ayka.in)
2. Go to **Clients** page → Click **"+ Add Client"**
3. Fill in:
   - **Name:** e.g., "Delhi Public School, Noida"
   - **Slug:** e.g., "dps-noida" (unique, lowercase, no spaces)
   - **Vertical:** "school" (or "realestate")
   - **Reseller:** Select from dropdown OR leave empty for direct client
   - **WhatsApp Config:**
     - Phone Number ID: `<from Meta>`
     - Access Token: `<from Meta>` (auto-encrypted on save)
     - WABA ID: `<from Meta>`
    - Verify Token: `spv_webhook_secret_2026`
4. Click **Create**

**OR via API (curl):**
```bash
TOKEN="<superadmin-jwt-token>"

curl -X POST https://api.ayka.site/api/superadmin/clients \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Delhi Public School, Noida",
    "slug": "dps-noida",
    "vertical": "school",
    "resellerId": null,
    "whatsapp": {
      "phoneNumberId": "123456789012345",
      "accessToken": "EAARhmw7BM...",
      "wabaId": "987654321098765",
      "verifyToken": "spv_webhook_secret_2026"
    },
    "settings": {
      "handoffPhone": "+919876543210",
      "timezone": "Asia/Kolkata"
    }
  }'
```

### Step 2: Create Dashboard User for the Client

1. In superadmin dashboard → **Users** page → **"+ Add User"**
2. Fill in:
   - **Email:** admin@dps-noida.com
   - **Password:** (strong, min 8 chars)
   - **Role:** client
   - **Business:** Select "Delhi Public School, Noida"
3. Click **Create**

**OR via API:**
```bash
curl -X POST https://api.ayka.site/api/superadmin/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@dps-noida.com",
    "password": "DPSNoida2026!",
    "role": "client",
    "businessId": "<business-id-from-step-1>"
  }'
```

### Step 3: Upload Knowledge Base

Connect to MongoDB and create the KB document:

```bash
cd /home/rudra/Ayka/ayka/apps/api
source $HOME/.nvm/nvm.sh

node -e "
require('dotenv').config()
const mongoose = require('mongoose')
const { KnowledgeBase } = require('@ayka/db')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  
  const kb = await KnowledgeBase.create({
    businessId: '<business-id>',
    content: {
      about: {
        name: 'Delhi Public School, Noida',
        address: 'Sector 30, Noida, UP - 201301',
        board: 'CBSE',
        affiliationNo: '2130456',
        type: 'Co-Educational Day School',
        level: 'Nursery to Class XII',
        email: 'info@dps-noida.com',
        website: 'www.dps-noida.com',
        tagline: 'Excellence in Education Since 1990',
        vision: 'Nurturing future leaders through holistic education'
      },
      academics: {
        classesOffered: ['Nursery', 'KG', 'I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII', 'IX', 'X', 'XI', 'XII'],
        medium: ['English'],
        streams: ['Science', 'Commerce', 'Humanities'],
        subjects: ['English', 'Hindi', 'Mathematics', 'Science', 'Social Studies']
      },
      admissions: {
        process: 'Registration form → Written test → Interaction → Admission',
        ageRequirements: { 'Nursery': '3+', 'KG': '4+', 'Class I': '5+' },
        documentsRequired: ['Birth Certificate', 'Aadhar Card', 'Transfer Certificate', 'Report Card', 'Passport Photos'],
        session: 'April to March'
      },
      fees: {
        // Add fee structure per class
      },
      campus: {
        facilities: ['Smart Classrooms', 'Science Labs', 'Computer Lab', 'Library', 'Sports Ground', 'Auditorium']
      },
      timing: {
        schoolHours: '8:00 AM – 2:30 PM (Mon–Fri), 8:00 AM – 12:30 PM (Sat)',
        officeHours: '9:00 AM – 4:00 PM (Mon–Sat)',
        visitHours: '10:00 AM – 1:00 PM (Mon–Fri)'
      },
      handoff: {
        staffPhone: '+919876543210',
        workingHours: '9 AM – 4 PM, Mon–Sat',
        triggerConditions: 'Fee negotiation, complaints, complex scheduling'
      }
    }
  })
  
  console.log('KB created:', kb._id)
  await mongoose.disconnect()
}

main().catch(console.error)
"
```

### Step 4: Enable Web Widget (Optional)

1. In dashboard → Go to the client's page
2. In **Clients** → Click the widget toggle ✅
3. Or use the Admin (reseller) dashboard → **Web Widget** page to configure:
   - Theme colors
   - Welcome message
   - Agent name
   - Collect fields (name, email, phone)

**OR via API:**
```bash
curl -X PATCH https://api.ayka.site/api/superadmin/clients/<business-id> \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "widget": {
      "enabled": true,
      "position": "bottom-right",
      "theme": {
        "primaryColor": "#0ea5e9",
        "headerBg": "#0f172a"
      },
      "welcomeMessage": "Hello! Welcome to DPS Noida. How can I help?",
      "agentName": "DPS Assistant",
      "collectName": true,
      "collectEmail": true,
      "collectPhone": true
    }
  }'
```

### Step 5: Add Widget to Client's Website

Add this code before `</body>` on the client's website:

```html
<script
  src="https://api.ayka.site/widget/embed/ayka-widget.js"
  data-business-id="<business-id>"
  data-api-url="https://api.ayka.site"
></script>
```

### Step 6: Configure WhatsApp Webhook

1. Go to Meta Developer Dashboard → Your App → WhatsApp → Configuration
2. Set Callback URL: `https://api.ayka.site/webhook/whatsapp`
3. Set Verify Token: `spv_webhook_secret_2026`
4. Subscribe to fields: `messages`, `message_status`
5. Send a test message to the WhatsApp number — should get AI response

### Step 7: Verify Everything Works

```bash
# 1. Check health
curl https://api.ayka.site/health

# 2. Login as the new client
curl -X POST https://api.ayka.site/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"admin@dps-noida.com","password":"DPSNoida2026!"}'

# 3. Check client stats (use token from login)
curl https://api.ayka.site/api/client/stats \
  -H "Authorization: Bearer <token>"

# 4. Test widget
curl https://api.ayka.site/widget/config/<business-id>

# 5. Send a WhatsApp message to the business number
# → Check the client dashboard for the lead
```

### Onboarding Checklist
- [ ] Business created in database
- [ ] Dashboard user created with correct role & businessId
- [ ] Knowledge base uploaded with complete content
- [ ] WhatsApp webhook configured and verified
- [ ] Widget enabled and embedded on website (if applicable)
- [ ] Test WhatsApp message sent and AI responded
- [ ] Test widget message sent and AI responded
- [ ] Client can login to dashboard and see data
- [ ] Lead appears in client dashboard after test message
- [ ] Handoff phone number set for urgent leads

---

## 7. Reseller Onboarding — Step by Step

### Step 1: Create Reseller

```bash
TOKEN="<superadmin-jwt>"

curl -X POST https://api.ayka.site/api/superadmin/resellers \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "name": "EduTech Partners",
    "slug": "edutech",
    "email": "admin@edutech.com",
    "phone": "+919876543210",
    "plan": {
      "name": "Professional",
      "botSlots": 10,
      "features": ["analytics", "widget", "whatsapp"]
    },
    "pricing": {
      "setupCost": 5000,
      "perBotCost": 2000,
      "monthlyPerBot": 1500
    },
    "themeConfig": {
      "primaryColor": "#8b5cf6",
      "accentColor": "#06b6d4",
      "logoUrl": "https://edutech.com/logo.png"
    }
  }'
```

### Step 2: Create Reseller Admin User

```bash
curl -X POST https://api.ayka.site/api/superadmin/users \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "email": "admin@edutech.com",
    "password": "EduTech2026!",
    "role": "reseller",
    "resellerId": "<reseller-id-from-step-1>"
  }'
```

### Step 3: Reseller Creates Their Own Clients

The reseller can now login to the dashboard and manage their portfolio. However, creating new businesses still requires superadmin (because WhatsApp config is sensitive). The reseller can:
- View all their clients
- Pause/resume client bots
- Configure widgets
- View leads, conversations, appointments
- Export data
- Update their own profile and theme

---

## 8. Superadmin Operations Guide

### Login
- URL: https://dashboard.ayka.site
- Email: superadmin@ayka.in
- Password: AyKaSuperAdmin2026!
- After login, you're redirected to `/superadmin/dashboard`

### Dashboard Pages

| Page | What It Shows |
|---|---|
| **Dashboard** | Platform stats (resellers, clients, conversations, hot leads), charts (volume, revenue, performance, verticals), reseller health table |
| **Resellers** | All resellers with CRUD (create, edit, deactivate, reactivate). Shows active clients, leads, revenue, fee status |
| **Clients** | All businesses across all resellers. CRUD operations, widget toggle, lead counts |
| **Users** | All dashboard users. Create, edit, deactivate, password reset |
| **Leads** | All leads across the platform. Filter by reseller, score. Shows parent name, client, reseller, messages, visit status |
| **System** | Three tabs: Health (DB counts, API status), Errors (recent errors), API Usage (LLM stats, model usage, concurrency, key health) |

### Common Tasks

**Deactivate a client:**
- Go to Clients → Click the client → Set isActive to false
- This stops the bot from responding AND deactivates the client's dashboard users

**Reset a user's password:**
- Go to Users → Find the user → Click Edit → Set new password

**Check LLM health:**
- Go to System → API Usage tab
- Shows: total calls, success rate, rate limit hits, avg latency
- Shows: per-key health (healthy/cooldown), model usage breakdown
- Shows: fallback calls to Azure OpenAI

**Add more Groq API keys:**
1. Get new key from https://console.groq.com
2. Update the `GROQ_API_KEYS` environment variable (comma-separated)
3. Restart the API (or update Azure Container App env vars)

---

## 9. Reseller Operations Guide

### Login
- URL: https://dashboard.ayka.site
- Use credentials provided by superadmin
- After login, redirected to `/admin/dashboard`

### Dashboard Pages

| Page | What It Shows |
|---|---|
| **Dashboard** | Portfolio stats, leads per client, score distribution, platform volume, conversion funnel, top clients, messages by day, activity feed, client health |
| **Clients** | Your clients with lead counts, status, last activity. Edit settings, pause/resume bots |
| **Leads** | All leads across your clients. Filter by client, score, search by name/phone. Click for detail slide-over |
| **Conversations** | Split-pane chat viewer. Left: conversation list. Right: full message history (read-only) |
| **Appointments** | All scheduled visits. Filter by client, status (confirmed, pending, cancelled) |
| **Analytics** | Score trend, avg time to score, conversion funnel, messages by day, monthly growth, top clients |
| **Web Widget** | Configure widget theme, welcome message, agent name, collect fields for each client. Live preview + embed code |
| **Settings** | Update your profile, email, phone, theme colors |

### Important Notes
- You can only see YOUR clients (enforced by `enforceResellerScope` middleware)
- You CANNOT create new businesses (superadmin only, due to WhatsApp credentials)
- You CAN pause/resume bots, configure widgets, and view all conversation data
- Theme colors you set propagate to your dashboard UI (white-label)

---

## 10. Client Operations Guide

### Login
- URL: https://dashboard.ayka.site
- Use credentials provided by admin/superadmin
- After login, redirected to `/client/dashboard`

### Dashboard Pages

| Page | What It Shows |
|---|---|
| **Dashboard** | Stats (leads, hot leads, visits, handoffs with MoM delta), lead volume chart, score distribution, daily messages, recent leads table, conversion funnel |
| **Leads** | All leads with search, score filter, date range, source filter. Detail slide-over. CSV export |
| **Conversations** | Split-pane chat viewer. Full message history with date separators. Search by name/phone |
| **Appointments** | Calendar + list view. Scheduled visits with status |
| **Settings** | School info (from KB), bot config (read-only), change password |

### Understanding Lead Scores
| Score | Meaning | Criteria |
|---|---|---|
| 🔴 **Hot** | Ready to convert | Name + class + phone collected, visit interest shown |
| 🟡 **Warm** | Engaged | Some data collected, asking questions |
| 🔵 **Cold** | Early stage | Just started conversation, minimal data |

### What Triggers Handoff
- Parent explicitly asks to speak to a human
- Complex fee negotiation needed
- Complaint or escalation
- When handoff triggers, the configured phone number receives a WhatsApp notification

---

## 11. Web Widget Setup Guide

### Embed Code
```html
<script
  src="https://api.ayka.site/widget/embed/ayka-widget.js"
  data-business-id="YOUR_BUSINESS_ID"
  data-api-url="https://api.ayka.site"
></script>
```

### Finding Your Business ID
- Login as superadmin → Clients page → The `_id` column
- Or from the API: `GET /api/superadmin/clients` → each client has `_id`

### Widget Configuration
Configure via Admin dashboard → Web Widget page, or via API:

```bash
curl -X PATCH https://api.ayka.site/api/admin/clients/<businessId>/widget \
  -H "Authorization: Bearer <reseller-token>" \
  -H "Content-Type: application/json" \
  -d '{
    "widget": {
      "enabled": true,
      "position": "bottom-right",
      "theme": {
        "primaryColor": "#0ea5e9",
        "headerBg": "#0f172a",
        "headerText": "#ffffff",
        "chatBg": "#f8fafc",
        "userBubble": "#0ea5e9",
        "botBubble": "#ffffff",
        "fontFamily": "system-ui, sans-serif",
        "borderRadius": "16px",
        "buttonSize": "60px"
      },
      "welcomeMessage": "Hello! How can I help you today?",
      "agentName": "AI Assistant",
      "collectName": true,
      "collectEmail": false,
      "collectPhone": true,
      "allowedOrigins": ["https://client-website.com"]
    }
  }'
```

### Testing Widget Locally
Open `apps/widget/demo.html` in a browser (API must be running on localhost:3000).

---

## 12. Knowledge Base Management

### Current Approach
KB is stored as a MongoDB document per business. Content is structured as:

```
content:
  about:        name, address, board, type, level, vision, tagline
  academics:    classesOffered, medium, streams, subjects
  admissions:   process, ageRequirements, documentsRequired, session
  fees:         structured fee data per class
  campus:       facilities array
  timing:       schoolHours, officeHours, visitHours
  handoff:      staffPhone, workingHours, triggerConditions
  principal:    name, message
```

### Update KB via Script
```bash
cd /home/rudra/Ayka/ayka/apps/api
source $HOME/.nvm/nvm.sh

# Update with businessId filter (REQUIRED for multi-tenant safety)
node scripts/update-kb.js <businessId>
# OR
BUSINESS_ID=<businessId> node scripts/update-kb.js

# Comprehensive update
node scripts/update-kb-comprehensive.js <businessId>
```

### Update KB via MongoDB Shell
```bash
node -e "
require('dotenv').config()
const mongoose = require('mongoose')
const { KnowledgeBase } = require('@ayka/db')

async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  
  await KnowledgeBase.updateOne(
    { businessId: '<business-id>' },
    { \$set: {
      'content.fees.classV': {
        tuition: 3500,
        developmentFee: 500,
        total: 4000,
        frequency: 'monthly'
      }
    }}
  )
  
  console.log('Updated')
  // Clear Redis cache so changes take effect immediately
  const redis = require('./src/config/redis')
  await redis.del('kb:<business-id>')
  console.log('Cache cleared')
  
  await mongoose.disconnect()
}
main()
"
```

---

## 13. LLM Configuration & Monitoring

### Model Tiering
| Scenario | Model | Speed | Quality |
|---|---|---|---|
| First 3 messages | llama-3.1-8b-instant | ⚡ Fast | Good |
| 4+ messages | llama-3.3-70b-versatile | 🐢 Slower | Excellent |

### API Key Rotation
- Multiple keys in `GROQ_API_KEYS` (comma-separated)
- Automatic round-robin rotation
- Rate-limited keys enter 60-second cooldown
- Cooldown expires → key re-enters rotation
- Monitor via System → API Usage → keyHealth array

### Azure OpenAI Fallback
When all Groq keys fail (after 3 retries), system falls back to Azure OpenAI:

1. **Deploy Azure OpenAI resource:**
```bash
az cognitiveservices account create \
  --name ayka-openai \
  --resource-group ayka-rg \
  --kind OpenAI \
  --sku S0 \
  --location centralindia

# Deploy a model
az cognitiveservices account deployment create \
  --name ayka-openai \
  --resource-group ayka-rg \
  --deployment-name gpt-4o-mini \
  --model-name gpt-4o-mini \
  --model-version "2024-07-18" \
  --model-format OpenAI \
  --sku-capacity 10 \
  --sku-name Standard
```

2. **Get API key:**
```bash
az cognitiveservices account keys list \
  --name ayka-openai \
  --resource-group ayka-rg
```

3. **Set env vars:**
```bash
AZURE_OPENAI_ENDPOINT=https://ayka-openai.openai.azure.com
AZURE_OPENAI_API_KEY=<key-from-step-2>
AZURE_OPENAI_DEPLOYMENT=gpt-4o-mini
```

### Concurrency Management
- Default: 5 concurrent LLM calls
- If more requests arrive, they queue (not rejected)
- Monitor via System → API Usage → concurrency.current / concurrency.queued
- Adjust via `LLM_MAX_CONCURRENCY` env var

---

## 14. Database Management

### Connect to MongoDB
```bash
cd /home/rudra/Ayka/ayka/apps/api
source $HOME/.nvm/nvm.sh
node -e "
require('dotenv').config()
const mongoose = require('mongoose')
const { Business, Reseller, User, Conversation, Message, Contact, KnowledgeBase, Appointment } = require('@ayka/db')
async function main() {
  await mongoose.connect(process.env.MONGODB_URI)
  console.log('Connected')
  // Your queries here...
  await mongoose.disconnect()
}
main()
"
```

### Useful Queries

**Count all documents:**
```javascript
const counts = {
  businesses: await Business.countDocuments(),
  resellers: await Reseller.countDocuments(),
  users: await User.countDocuments(),
  conversations: await Conversation.countDocuments(),
  messages: await Message.countDocuments(),
  contacts: await Contact.countDocuments(),
  knowledgebases: await KnowledgeBase.countDocuments(),
  appointments: await Appointment.countDocuments(),
}
console.log(counts)
```

**Find all hot leads for a business:**
```javascript
const hotLeads = await Conversation.find({
  businessId: '<id>',
  leadScore: 'hot'
}).populate('contactId', 'name phone').lean()
```

**Reset a user's password:**
```javascript
const bcrypt = require('bcryptjs')
await User.updateOne(
  { email: 'user@example.com' },
  { $set: { password: await bcrypt.hash('NewPassword123!', 12) } }
)
```

**Clear Redis session cache:**
```javascript
const redis = require('./src/config/redis')
// Clear specific session
await redis.del('session:<businessId>:<phone>')
// Clear all sessions (use carefully!)
// Upstash doesn't support SCAN — clear by knowing keys
```

---

## 15. Monitoring & Troubleshooting

### Health Check
```bash
curl https://api.ayka.site/health
# Expected: {"status":"ok","timestamp":"...","service":"ayka-api"}
```

### Check API Logs (Azure)
```bash
az containerapp logs show \
  --name ayka-api \
  --resource-group ayka-rg \
  --follow \
  --tail 100
```

### Check API Logs (Local)
```bash
tail -f /tmp/api.log
# Or filter for errors:
tail -100 /tmp/api.log | grep -i "error\|fail\|warn"
```

### Common Issues

| Symptom | Cause | Fix |
|---|---|---|
| Bot not responding | API down or Groq rate limited | Check health endpoint, check LLM stats for rate limits |
| "Session not found" | Redis cache expired | Normal — MongoDB fallback rebuilds session automatically |
| Widget returns 404 | Widget not enabled for business | Enable via dashboard or API |
| Dashboard shows NaN | Stats API returning unexpected shape | Check API response format matches dashboard expectations |
| Duplicate messages | WhatsApp webhook retry | Normal — dedup layer catches these (in-memory + Redis) |
| Slow responses | LLM queue full | Increase `LLM_MAX_CONCURRENCY` or add more Groq API keys |
| Login fails | Wrong credentials or user deactivated | Check user.isActive in DB, reset password if needed |
| Widget CORS error | Origin not allowed | Widget CORS is permissive by default; check browser console |

### LLM Stats Endpoint
```bash
TOKEN="<superadmin-jwt>"
curl https://api.ayka.site/api/superadmin/system/api-usage \
  -H "Authorization: Bearer $TOKEN"
```

Returns:
```json
{
  "totalCalls": 142,
  "successfulCalls": 140,
  "failedCalls": 2,
  "rateLimitHits": 3,
  "avgLatencyMs": 1200,
  "modelUsage": { "llama-3.1-8b-instant": 80, "llama-3.3-70b-versatile": 62 },
  "fallbackCalls": 0,
  "concurrency": { "current": 1, "max": 5, "peak": 4, "queued": 0 },
  "keyCount": 1,
  "keyHealth": [{ "key": 1, "healthy": true, "rateLimitHits": 3 }]
}
```

---

## 16. Security Checklist

- [x] WhatsApp access tokens encrypted at rest (AES-256)
- [x] JWT tokens with 7-day expiry
- [x] Role-based access control (superadmin/reseller/client)
- [x] Business scope enforcement (client can only see own data)
- [x] Reseller scope enforcement (reseller can only see own portfolio)
- [x] Rate limiting on login (10 attempts per 15 min)
- [x] Rate limiting on widget messages (20 per min per visitor)
- [x] Webhook signature verification (Meta App Secret)
- [x] Message deduplication (prevents replay attacks)
- [x] No plaintext secrets in code (all in env vars)
- [ ] **TODO:** Rotate JWT_SECRET periodically
- [ ] **TODO:** Set up IP allowlist for dashboard (optional)
- [ ] **TODO:** Enable MongoDB audit logging on Azure VM
- [ ] **TODO:** Add HTTPS-only cookie flag for dashboard sessions

---

## 17. Backup & Recovery

### MongoDB Backup (Azure VM)
Data lives on the Azure VM. Run regular `mongodump` backups and store off-VM. To restore:
1. Copy a backup directory to the VM
2. Run `mongorestore --uri="mongodb://aykaadmin:AykaDB2026@20.235.104.28:27017/ayka?authSource=admin" ./backup-dir`
3. Verify collections are intact via MongoDB Compass

### Manual Data Export
```bash
# Export all collections
mongodump --uri="mongodb://aykaadmin:AykaDB2026@20.235.104.28:27017/ayka?authSource=admin" --out ./backup-$(date +%Y%m%d)

# Export specific collection
mongoexport --uri="mongodb://aykaadmin:AykaDB2026@20.235.104.28:27017/ayka?authSource=admin" --collection=businesses --out=businesses.json
```

### Environment Recovery
All env vars are documented in `apps/api/.env.production`. If Azure Container App is lost:
1. Rebuild Docker image from source
2. Push to ACR
3. Create new Container App with env vars from `.env.production`
4. Update DNS to point to new app
5. Reconfigure Meta webhook URL

---

*This document is the single source of truth for AyKa platform operations. Keep it updated as the system evolves.*
