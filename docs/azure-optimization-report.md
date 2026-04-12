# Azure Cost Optimization Report - AyKa AI Automation
**Date:** 1 March 2026  
**Credit Balance:** $990.28 / $1,000.00 (Microsoft for Startups)  
**Expiry:** 16 May 2026  
**Subscription:** c195aafa-78b1-484f-9c73-01f0a93f8102  

---

## 1. Current Resource Inventory

### Resource Group: `ayka-rg` (Main Bot Platform)
| Resource | SKU/Config | Est. Monthly Cost |
|---|---|---|
| Container App `ayka-api` | 1 vCPU, 2 GiB RAM, 1–5 replicas | ~$7.20 |
| Container Registry `aykaregistry` | Basic SKU | ~$5.00 |
| Log Analytics Workspace | Default tier | ~$0.50 |
| Managed Environment | Shared | $0 (included) |
| **Subtotal** | | **~$12.70** |

### Resource Group: `ayka-erm-rg` (Separate ERM System)
| Resource | SKU/Config | Est. Monthly Cost |
|---|---|---|
| Container Apps (×5) | Minimal replicas | ~$15.00 |
| Container Registry `aykacr` | Basic SKU | ~$5.00 |
| Static Web Apps (×3) | Free SKU | $0 |
| **Subtotal** | | **~$20.00** |

### Total Monthly Spend: **~$32.70**
### Runway at Current Burn: **~30 months** (well beyond credit expiry)
### Credit Remaining After Expiry: **~$908** unused if no changes

---

## 2. Optimization Recommendations

### ✅ Already Optimized
- **Static Web Apps** on Free SKU - perfect for dashboards
- **Container Apps** with autoscale (1–5 replicas) - pay-per-use
- **No VMs** - serverless-first approach saves significantly

### 🔧 Immediate Actions (save ~$10/month)

#### A. Merge Container Registries → Save $5/month
You have two registries (`aykaregistry` + `aykacr`). Merge to one:
```bash
# Pick one registry, push all images there
az acr import --name aykaregistry --source aykacr.azurecr.io/image:tag
# Delete the redundant registry
az acr delete --name aykacr --yes
```
**Savings: $5/month**

#### B. Enable Scale-to-Zero on ERM Apps
If the 5 ERM container apps aren't actively used, set min replicas to 0:
```bash
az containerapp update --name <app-name> -g ayka-erm-rg --min-replicas 0
```
**Savings: Up to $12/month** (apps scale down when idle)

#### C. Log Analytics Retention → 30 days (default is 90)
```bash
az monitor log-analytics workspace update -g ayka-rg -n <workspace> --retention-time 30
```
**Savings: ~$0.50/month** (minor but free optimization)

### 📈 Strategic Spending (use credits before they expire)

Since credits expire **16 May 2026** with ~$990 remaining, you should **strategically invest** in services that improve the product:

#### D. Azure OpenAI (Priority - Use $200-300)
Deploy GPT-4o-mini as your Groq fallback:
```bash
az cognitiveservices account create \
  --name ayka-openai \
  --resource-group ayka-rg \
  --kind OpenAI \
  --sku S0 \
  --location centralindia

az cognitiveservices account deployment create \
  --name ayka-openai \
  --resource-group ayka-rg \
  --deployment-name gpt-4o-mini \
  --model-name gpt-4o-mini \
  --model-version "2024-07-18" \
  --model-format OpenAI \
  --sku-capacity 30 \
  --sku-name Standard
```
- **Cost:** ~$0.15/1K input tokens, ~$0.60/1K output tokens
- **Budget:** At ~2000 tokens/conversation, $200 covers ~150K conversations as fallback
- **Already wired** in groq.service.js v5.0 - just uncomment .env vars

#### E. Azure CDN for Widget JS ($5/month → Faster Loads)
Serve `ayka-widget.js` from a CDN instead of the API server:
```bash
az cdn profile create -g ayka-rg -n ayka-cdn --sku Standard_Microsoft
az cdn endpoint create -g ayka-rg --profile-name ayka-cdn \
  -n ayka-widget --origin ayka-api.wonderfulisland-7d20e685.centralindia.azurecontainerapps.io
```
- Widget loads faster from edge nodes across India
- Reduces load on the API container

#### F. Azure Redis Cache for Production ($13/month Basic)
Replace Upstash with Azure Redis for lower latency (same region):
```bash
az redis create -g ayka-rg -n ayka-redis --sku Basic --vm-size C0 --location centralindia
```
- Sub-millisecond latency (vs Upstash's network hop)
- Keeps all infra in one ecosystem

#### G. Azure Monitor Alerts (Free)
Set up alerts for critical thresholds:
```bash
# Alert if API container restarts > 3 times in 5 min
# Alert if response time > 5 seconds
# Alert if memory usage > 80%
```
No additional cost - included with Container Apps.

---

## 3. Recommended Budget Allocation

| Category | Budget | Purpose |
|---|---|---|
| Core Infra (Container Apps + Registry) | $80 | 2.5 months of base operation |
| Azure OpenAI Fallback | $250 | ~150K fallback conversations |
| Azure CDN | $15 | 3 months of edge delivery |
| Azure Redis (optional) | $40 | 3 months, lower latency sessions |
| Buffer / Testing | $100 | Load testing, staging env |
| **Unallocated** | **$505** | Roll forward or new services |
| **Total** | **$990** | |

---

## 4. Scaling Plan

### Phase 1: Current (0–50 clients)
- 1 Container App, 1–5 replicas auto-scale
- Groq free tier + multi-key rotation
- Upstash Redis (free tier)
- **Cost: ~$13/month**

### Phase 2: Growth (50–200 clients)
- Bump to 2 vCPU, 4 GiB per replica
- Azure OpenAI as active fallback
- Azure Redis Basic for sessions
- CDN for widget delivery
- **Cost: ~$45/month**

### Phase 3: Scale (200–1000 clients)
- Multiple Container App revisions (blue/green deploy)
- Azure OpenAI as primary, Groq as cost-saver
- Redis Standard (replicated)
- Multi-region Container Apps (Central India + South India)
- **Cost: ~$120/month**

---

## 5. Action Items

| # | Action | Impact | Effort |
|---|---|---|---|
| 1 | Deploy Azure OpenAI `gpt-4o-mini` | Fallback resilience | 30 min |
| 2 | Merge container registries | Save $5/mo | 15 min |
| 3 | Set ERM apps to scale-to-zero | Save $12/mo | 10 min |
| 4 | Set up Azure Monitor alerts | Ops visibility | 20 min |
| 5 | Deploy CDN for widget | Faster embed loads | 30 min |
| 6 | Update Dockerfile (widget dist) | Already done ✅ | Done |

---

*Report generated by AyKa system audit. All estimates based on Azure Central India pricing as of March 2026.*
