# AyKa

AyKa is a Node.js workspace with two runnable apps:

- `@ayka/api`: Express API on port `3000`
- `@ayka/dashboard`: Next.js dashboard on port `3001`

## Prerequisites

- Node.js 20+
- npm
- Valid API environment values in `apps/api/.env`
- Reachable MongoDB and Redis instances from `MONGODB_URI` and `REDIS_URL`

For the current local Docker services:

```dotenv
MONGODB_URI=mongodb://ayka_mailflow:localdev@127.0.0.1:27017/ayka?authSource=admin
REDIS_URL=redis://:localdev@127.0.0.1:6381
REDIS_PASSWORD=localdev
```

## Install

```bash
npm install
```

## Development

Run the API and dashboard together:

```bash
npm run dev
```

Or run them separately:

```bash
npm run dev:api
npm run dev:dashboard
```

Open the dashboard at `http://localhost:3001`. The local dashboard resolves API calls to `http://localhost:3000`.

## Demo Tenants

Seed the Buildsworth education/training demo:

```bash
npm run seed:buildsworth --workspace @ayka/api
```

Buildsworth dashboard login:

```text
Email: admin@buildsworthgroup.com
Password: BuildsworthDemo2026!
```

Switch one shared Meta test phone number between demos:

```bash
DEMO_SLUG=buildsworth WA_PHONE_NUMBER_ID=<meta-phone-number-id> WA_ACCESS_TOKEN=<meta-token> WA_WABA_ID=<waba-id> npm run switch:demo-phone --workspace @ayka/api
DEMO_SLUG=realestate WA_PHONE_NUMBER_ID=<meta-phone-number-id> WA_ACCESS_TOKEN=<meta-token> WA_WABA_ID=<waba-id> npm run switch:demo-phone --workspace @ayka/api
DEMO_SLUG=spv WA_PHONE_NUMBER_ID=<meta-phone-number-id> WA_ACCESS_TOKEN=<meta-token> WA_WABA_ID=<waba-id> npm run switch:demo-phone --workspace @ayka/api
```

The switch command assigns the shared phone number to the selected tenant, moves any conflicting demo tenant to an offline placeholder ID, encrypts the access token, and clears the Redis tenant cache.

## Production-style run

Build the dashboard:

```bash
npm run build
```

Start the API and built dashboard:

```bash
npm start
```

## Docker

```bash
docker compose up -d
```

Docker uses `apps/api/.env.production` for the API and serves the dashboard on port `3001`.
