FROM node:20-alpine AS base
WORKDIR /app

# Install deps layer (cached unless package.json changes)
FROM base AS deps
COPY package.json package-lock.json ./
RUN npm ci --ignore-scripts

# Build layer
FROM deps AS builder
COPY . .
RUN npm run build

# Production image — only the built output + native modules needed at runtime
FROM node:20-alpine AS runner
WORKDIR /app
ENV NODE_ENV=production

RUN addgroup --system --gid 1001 stocktrack && \
    adduser  --system --uid 1001 stocktrack

# Copy build output
COPY --from=builder --chown=stocktrack:stocktrack /app/.output ./.output

# Copy node_modules that contain native binaries (better-sqlite3)
COPY --from=deps --chown=stocktrack:stocktrack /app/node_modules ./node_modules

# Persistent data dir for SQLite file
RUN mkdir -p /app/data && chown stocktrack:stocktrack /app/data

USER stocktrack

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD wget -qO- http://localhost:3000/api/health || exit 1

CMD ["node", ".output/server/index.mjs"]
