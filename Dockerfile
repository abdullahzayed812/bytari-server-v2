# syntax=docker/dockerfile:1

# ---------- Base ----------
FROM node:20-alpine AS base
WORKDIR /app
ENV NODE_ENV=production
RUN apk add --no-cache tini

# ---------- Dependencies (all, for building) ----------
FROM base AS deps
COPY package.json package-lock.json* ./
RUN npm ci --include=dev

# ---------- Build ----------
FROM deps AS build
COPY tsconfig.json tsconfig.build.json ./
COPY src ./src
RUN npm run build

# ---------- Production dependencies only ----------
FROM base AS prod-deps
COPY package.json package-lock.json* ./
RUN npm ci --omit=dev

# ---------- Runtime ----------
FROM base AS runtime
ENV PORT=3000
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/dist ./dist
COPY package.json ./

# Drop privileges.
USER node

EXPOSE 3000

# Liveness probe — hits the unauthenticated /health endpoint with no extra
# tooling (Node 20 ships a global fetch). Readiness (DB reachable) is a separate
# concern: orchestrators should poll GET /health/ready.
HEALTHCHECK --interval=30s --timeout=5s --start-period=20s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.PORT||3000)+'/health').then(r=>{process.exit(r.ok?0:1)}).catch(()=>process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
# Apply migrations + idempotent catalogue seeds, then start the API. tini reaps
# zombies and forwards SIGTERM/SIGINT so server.ts can shut down gracefully.
CMD ["sh", "-c", "node dist/database/migrate.js latest && node dist/database/migrate.js seed && node dist/server.js"]
