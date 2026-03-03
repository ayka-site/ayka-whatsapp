FROM node:20-alpine AS builder
WORKDIR /app

COPY package.json package-lock.json ./
COPY packages/db/package.json ./packages/db/
COPY apps/api/package.json ./apps/api/

RUN npm ci --ignore-scripts

COPY packages/ ./packages/
COPY apps/api/ ./apps/api/
COPY apps/widget/ ./apps/widget/

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
COPY --from=builder /app/apps/widget ./apps/widget

EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "index.js"]
