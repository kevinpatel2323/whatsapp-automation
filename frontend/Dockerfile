# Next.js standalone build. Build context: monorepo root.

FROM node:20-bookworm-slim AS build
WORKDIR /app
COPY package.json package-lock.json ./
COPY backend/package.json backend/
COPY frontend/package.json frontend/
RUN npm ci
COPY frontend ./frontend
# NEXT_PUBLIC_* are statically replaced at build, so they must be set here.
ARG NEXT_PUBLIC_BACKEND_URL=""
ARG NEXT_PUBLIC_SOCKETIO_PATH="/socket.io/"
ENV NEXT_PUBLIC_BACKEND_URL=${NEXT_PUBLIC_BACKEND_URL}
ENV NEXT_PUBLIC_SOCKETIO_PATH=${NEXT_PUBLIC_SOCKETIO_PATH}
RUN npm run build -w frontend

FROM node:20-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV HOSTNAME=0.0.0.0
ENV PORT=3100
COPY --from=build /app/frontend/.next/standalone ./
COPY --from=build /app/frontend/.next/static ./frontend/.next/static
COPY --from=build /app/frontend/public ./frontend/public
EXPOSE 3100
CMD ["node", "frontend/server.js"]
