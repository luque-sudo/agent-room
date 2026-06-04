# AgentRoom Service — Dockerfile
#
# Build:  docker build -t agent-room-service .
# Run:    docker run -p 9000:9000 agent-room-service
# Custom: docker run -p 8080:8080 -e PORT=8080 agent-room-service

# ─── Build stage ─────────────────────────────────────────────────────
FROM node:20-alpine AS builder

WORKDIR /app

# Install pnpm
RUN corepack enable && corepack prepare pnpm@latest --activate

# Install dependencies
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --frozen-lockfile

# Copy source and compile
COPY tsconfig.json ./
COPY src/ ./src/
RUN pnpm run build

# ─── Production stage ────────────────────────────────────────────────
FROM node:20-alpine

WORKDIR /app

RUN corepack enable && corepack prepare pnpm@latest --activate

# Only production dependencies
COPY package.json pnpm-lock.yaml* ./
RUN pnpm install --prod --frozen-lockfile

# Copy compiled JS
COPY --from=builder /app/dist ./dist

# Service runs on port 9000 by default
ENV PORT=9000
ENV HOST=0.0.0.0
EXPOSE 9000

# Health check
HEALTHCHECK --interval=30s --timeout=5s --start-period=5s --retries=3 \
  CMD wget -qO- http://localhost:${PORT}/health || exit 1

# Run the Service
CMD ["node", "dist/service/index.js"]
