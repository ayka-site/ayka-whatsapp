FROM node:20-alpine AS builder
WORKDIR /app

# Copy root workspace config + lockfile
COPY package.json package-lock.json ./

# Copy ALL workspace package.json files (npm ci needs them for workspace resolution)
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/
COPY apps/dashboard/package.json ./apps/dashboard/
COPY apps/widget/package.json ./apps/widget/

# Use npm install (not ci) because workspace package.json files may have
# minor differences from lockfile due to local development environment.
# --ignore-scripts skips postinstall hooks for faster builds.
# --omit=dev skips devDependencies (not needed in production image).
RUN npm install --ignore-scripts --omit=dev

# Copy only the packages/apps needed for the API
COPY packages/ ./packages/
COPY apps/api/ ./apps/api/

FROM node:20-alpine
WORKDIR /app

COPY --from=builder /app/node_modules ./node_modules
COPY --from=builder /app/packages ./packages
COPY --from=builder /app/apps/api ./apps/api
# Copy root package.json (needed for workspace symlink resolution at runtime)
COPY --from=builder /app/package.json ./package.json

EXPOSE 3000
WORKDIR /app/apps/api
CMD ["node", "index.js"]
