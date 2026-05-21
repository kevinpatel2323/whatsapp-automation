# Build the backend as compiled JS from /app/backend/dist, then ship a slim
# runtime image with only production deps.
#
# Build context: monorepo root (npm workspaces shares a single lockfile).

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY backend ./backend
RUN npm run build -w backend

FROM node:20-bookworm-slim AS prod-deps
WORKDIR /app
ENV NODE_ENV=production
COPY package.json package-lock.json ./
COPY backend/package.json backend/
RUN npm ci --omit=dev --workspace backend --include-workspace-root

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV BACKEND_PORT=4100
COPY --from=prod-deps /app/node_modules ./node_modules
COPY --from=build /app/backend/dist ./backend/dist
COPY backend/package.json ./backend/package.json
RUN mkdir -p /app/backend/auth_info
EXPOSE 4100
HEALTHCHECK --interval=30s --timeout=10s --start-period=40s --retries=3 \
  CMD node -e "fetch('http://127.0.0.1:'+(process.env.BACKEND_PORT||4100)+'/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"
CMD ["node", "backend/dist/index.js"]
