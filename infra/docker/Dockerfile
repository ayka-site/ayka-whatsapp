FROM node:20-alpine AS builder
WORKDIR /app

# Copy root workspace config + lockfile
COPY package.json package-lock.json ./

# Copy ALL workspace package.json files (npm ci needs them for workspace resolution)
COPY packages/db/package.json ./packages/db/
COPY packages/shared/package.json ./packages/shared/
COPY apps/api/package.json ./apps/api/

# Create stubs for workspaces not deployed in this image
# (npm ci with workspaces needs a package.json in every workspace dir)
RUN mkdir -p apps/dashboard apps/widget \
 && echo '{"name":"@ayka/dashboard","version":"1.0.0","private":true}' > apps/dashboard/package.json \
 && echo '{"name":"@ayka/widget","version":"1.0.0","private":true}' > apps/widget/package.json

RUN npm ci --ignore-scripts

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
