FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace manifests and lockfile first for deterministic dependency install.
COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/widget/package.json ./apps/widget/

# Install only the API workspace and its linked workspace dependencies. The API
# image must not inherit dashboard/widget packages such as Next.js or PostCSS.
RUN npm ci --workspace @ayka/api --workspace @ayka/db --omit=dev

COPY packages/db/ ./packages/db/
COPY apps/api/ ./apps/api/

FROM node:22-alpine
WORKDIR /app
RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages/db ./packages/db
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "index.js"]
