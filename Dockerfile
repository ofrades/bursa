FROM node:24-bookworm-slim AS base
WORKDIR /app

FROM base AS deps
RUN apt-get update && apt-get install -y python3 make g++ && rm -rf /var/lib/apt/lists/*
RUN corepack enable
COPY package.json pnpm-lock.yaml ./
RUN pnpm install --frozen-lockfile

FROM deps AS builder
COPY . .
RUN pnpm exec vite build

FROM node:24-bookworm-slim AS runner
WORKDIR /app
ENV NODE_ENV=production
ENV PORT=3000

RUN groupadd --system --gid 1001 stocktrack && \
    useradd --system --uid 1001 --gid 1001 --create-home stocktrack

COPY --from=builder --chown=stocktrack:stocktrack /app/.output ./.output

RUN mkdir -p /app/data && chown -R stocktrack:stocktrack /app

USER stocktrack

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD node -e "fetch('http://127.0.0.1:3000/api/health').then(r => { if (!r.ok) process.exit(1) }).catch(() => process.exit(1))"

CMD ["node", ".output/server/index.mjs"]
