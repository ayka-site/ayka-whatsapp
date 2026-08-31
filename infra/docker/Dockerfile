FROM node:22-alpine AS builder
WORKDIR /app

# Copy workspace manifests and the lockfile first so dependency installation is
# reproducible and cacheable. Production must build from the exact reviewed
# dependency graph committed to package-lock.json.
COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/widget/package.json ./apps/widget/

RUN npm ci --ignore-scripts --omit=dev

# Copy only the packages/apps needed by the API runtime.
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

FROM node:22-alpine
WORKDIR /app

# docker-compose uses curl for the readiness healthcheck.
RUN apk add --no-cache curl

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/package.json ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json

ENV NODE_ENV=production
EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "index.js"]
