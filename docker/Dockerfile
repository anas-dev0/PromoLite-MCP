# syntax=docker/dockerfile:1
#
# Multi-stage build. Build context = the repository root:   docker build -f docker/Dockerfile .
#   Stage 1 (build):   installs ALL dependencies (TypeScript, Vite, ...) and compiles the server + the views.
#   Stage 2 (runtime): only production dependencies + the compiled output + the data. No compilers, no source, no tests.

# ---------- Stage 1: build ----------
FROM node:22-alpine AS build
WORKDIR /app

# Copy the dependency manifests FIRST: while they do not change, Docker reuses the cached `npm ci` layer.
COPY package.json package-lock.json ./
RUN npm ci

COPY tsconfig.json ./
COPY scripts ./scripts
COPY src ./src
RUN npm run build        # tsc (server -> dist/server) + Vite (views -> dist/views, one HTML file each)

# ---------- Stage 2: runtime ----------
FROM node:22-alpine AS runtime
WORKDIR /app

ENV NODE_ENV=production \
    HOST=0.0.0.0 \
    PORT=3000 \
    # Even if someone runs the bare image, the Host header is validated. Real deployments override this.
    ALLOWED_HOSTS=localhost,127.0.0.1

COPY package.json package-lock.json ./
RUN npm ci --omit=dev && npm cache clean --force

COPY --from=build /app/dist ./dist
COPY data ./data

# Never run as root inside a container: if the app is ever compromised, the attacker is an unprivileged user.
# (The official node image ships a `node` user.) Nothing in /app needs to be writable at runtime.
USER node

EXPOSE 3000

# Docker (and Compose's depends_on) use this to know the app is really serving, not just started.
HEALTHCHECK --interval=15s --timeout=3s --start-period=10s --retries=3 \
  CMD wget -q -O /dev/null http://127.0.0.1:3000/health || exit 1

CMD ["node", "dist/server/http.js"]
