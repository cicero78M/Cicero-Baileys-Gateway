# ── Stage 1: install production dependencies ────────────────────────────────
FROM node:20-alpine AS deps

WORKDIR /app

# Copy only manifests first to leverage Docker layer caching
COPY package.json package-lock.json ./

RUN npm ci --omit=dev --prefer-offline

# ── Stage 2: production image ────────────────────────────────────────────────
FROM node:20-alpine AS production

# Install tini for proper PID-1 signal handling
RUN apk add --no-cache tini

ENV NODE_ENV=production

WORKDIR /app

# Run as unprivileged user
RUN addgroup -S appgroup && adduser -S appuser -G appgroup

# Copy production node_modules from deps stage
COPY --from=deps /app/node_modules ./node_modules

# Copy application source
COPY app.js ./
COPY sync-to-neon.js ./
COPY src ./src

# Create directories for persistent WA session data and uploads
# (these should be mounted as volumes in production)
RUN mkdir -p auth_info_baileys uploads laphar backups \
    && chown -R appuser:appgroup /app

USER appuser

EXPOSE 3000

HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
  CMD node -e "require('http').get('http://localhost:3000/', (r) => process.exit(r.statusCode === 200 ? 0 : 1)).on('error', () => process.exit(1))"

ENTRYPOINT ["/sbin/tini", "--"]
CMD ["node", "app.js"]
