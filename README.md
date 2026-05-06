# WhatsApp automation (Baileys v7 + Next.js + TypeORM + Postgres)

Monorepo with:

- **Backend** (`/backend`) — [Baileys](https://github.com/WhiskeySockets/Baileys) WhatsApp session, [Socket.io](https://socket.io) for the UI (QR, connection, live messages), [TypeORM](https://typeorm.io) + [PostgreSQL](https://www.postgresql.org/).
- **Frontend** (`/frontend`) — [Next.js 15](https://nextjs.org) App Router, [Tailwind CSS](https://tailwindcss.com), shadcn-style components, [socket.io-client](https://socket.io/docs/v4/client-api).

Sockets used end-to-end:

1. **Baileys** ↔ WhatsApp (Web client protocol, WebSocket per Baileys).
2. **Socket.io** ↔ your dashboard (real-time QR, `connection:state`, `message:new`).

## Prerequisites

- **Node.js** 20+ (recommend 20.19+ or 22+ to satisfy tooling)
- **PostgreSQL** on `localhost:5432` (or set `DATABASE_URL`).

## Setup

1. **Postgres** (optional helper):

   ```bash
   docker compose up -d
   ```

2. **Env** — copy the example and adjust as needed:

   ```bash
   cp .env.example .env
   ```

   - `DATABASE_URL` — e.g. `postgres://postgres:postgres@localhost:5432/wa_automation` (match `docker-compose.yml` if you use it).
   - `NEXT_PUBLIC_BACKEND_URL` — usually `https://x0xxmvbn-4000.inc1.devtunnels.ms/` for local dev.
   - `FRONTEND_ORIGIN` — usually `http://localhost:3002` (CORS + Socket.io).
   - `TYPEORM_SYNC` — if unset, sync is **on** (handy in dev; set to `false` in production and use migrations).

3. **Install and run**

   ```bash
   npm install
   npm run dev
   ```

4. Open **<http://localhost:3002>**, click **Connect**, scan the QR in WhatsApp → **Linked devices**.

## API (REST)

- `GET /api/session/status` — `{ "status": "idle" | "connecting" | "open" | "close" }`
- `POST /api/session/start` — start / resume the Baileys session
- `POST /api/session/logout` — end session and remove `backend/auth_info/`
- `GET /api/chats` — list chats
- `GET /api/messages?limit=50&before=…&remoteJid=…` — paginate stored messages (optional JID filter)
- `GET /api/settings` / `PATCH /api/settings` — auto-reply: enable, WTB/WTS (optional if `ignoreIntent`), per-match `matchReplies` map, optional `replyText` fallback, `replyExclusions` (name + number/JID to never DM), cooldown
- `GET /api/auto-replies?limit=50` — log of DMs sent by the auto-reply feature

## Auto-reply (IPL tickets)

- Incoming messages are classified (buy/sell + which configured match, e.g. `MI vs CSK`) and stored on each message row.
- If enabled, the app **DMs the sender** (not the group) using the **per-match** message for `matchedMatch`, or the **fallback** `replyText` if that match has no text. With **ignore intent** (default on), a match mention alone is enough; otherwise WTB/WTS must match and respect the buy/sell toggles. Only **live** `notify` upserts (not history sync) and outside the cooldown window.
- Configure in the **Auto-reply** card on the dashboard, or seed defaults via `AUTO_REPLY_*` in `.env` (first DB init only; then use the UI or `PATCH /api/settings`). `AUTO_REPLY_IGNORE_INTENT` defaults to `true` on seed.
- Socket: `settings:updated`, `auto-reply:sent`.

## Socket.io events (server → client)

- `qr` — `{ "qr": "<string>" }`
- `connection:state` — `{ "state": "connecting" | "open" | "close" }`
- `message:new` — one stored message (same shape as DB payload; includes `intent` / `matchedMatch` when classified)
- `settings:updated` — auto-reply settings object after `PATCH /api/settings`
- `auto-reply:sent` — `{ counterpartyJid, sourceMessageId, sourceRemoteJid }` when a DM was sent

## Database

Messages and chat rows are created from:

- `messages.upsert` and, when history syncs, `messaging-history.set` / `chats.upsert`.

Auth files live under `backend/auth_info/` (gitignored, multi-file auth for Baileys 7+).

## Architecture (high level)

```mermaid
flowchart LR
  WA[WhatsApp] <--> Baileys
  Baileys -->|persist| TypeORM[TypeORM]
  TypeORM --> PG[(Postgres)]
  Baileys -->|Socket.io| UI[Next.js]
  UI -->|REST| API[Express]
  API --> Baileys
```

## Notes

- Baileys 7+ uses LIDs/PN; we store `remoteJid` / `participant` plus alts on the `messages` table as provided by the protocol. Do not “restore PN” in app logic; treat IDs as the source of truth.
- The UI does not poll: new rows arrive over Socket.io. Initial history may come from the REST `GET /api/messages` call.

## Scripts

- `npm run dev` — backend + frontend in parallel
- `npm run build` — `backend` + `frontend` build (where applicable)
- `npm run typecheck -w backend` — typecheck the API only

## Security

- This stack is for **local development** / trusted networks. The dashboard has no auth. Do not expose the backend to the public internet without reverse proxy, auth, and TLS.
