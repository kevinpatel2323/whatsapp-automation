# Backend Architecture and API Flow

This document describes the **Node.js backend** (`backend/src`): process layout, **Express** REST API, **Socket.io** realtime layer, **Baileys** WhatsApp integration, **TypeORM** persistence, and how they connect. For UI behavior and client socket usage, see [`design.md`](./design.md).

---

## 1. Process model

- **One Node process** serves:
  - **HTTP** (Express) — JSON API under **`/api/*`**, plus **`GET /health`**
  - **WebSocket** (Socket.io) on the **same** `http.Server` and **same TCP port** (default **4000**, `BACKEND_PORT`)
- **Single Baileys session** per process: one `makeWASocket` instance at a time, multi-file auth under **`backend/auth_info`** (`authDir` in `config.ts`).
- **PostgreSQL** via TypeORM; entities: **`Chat`**, **`Message`**, **`AutoReplySettings`**, **`AutoReplyLog`**.

```mermaid
flowchart TB
  subgraph process [Node process]
    HTTP[http.Server]
    APP[Express app]
    IO[Socket.io Server]
    WA[BaileysService]
    AR[AutoReplyService]
    DS[(TypeORM DataSource)]
    EM[RealtimeEmits]

    HTTP --> APP
    HTTP --> IO
    APP --> DS
    WA --> DS
    AR --> DS
    WA --> EM
    AR --> EM
    IO --> EM
  end

  CLIENT[Browser / Next.js]
  PG[(PostgreSQL)]
  WAP[WhatsApp servers]

  CLIENT <-->|HTTP REST| APP
  CLIENT <-->|Socket.io| IO
  DS <--> PG
  WA <--> WAP
```

**Important:** Socket.io attaches to the **same** `http.Server` as Express (`backend/src/index.ts`). Clients connect to **`http(s)://host:port`** with path **`/socket.io/`** (Socket.io default). There is **no** separate WebSocket port.

---

## 2. Boot sequence (`backend/src/index.ts`)

Order of operations (must remain stable for “no missed events” on the client):

1. **`dotenv`** — loads, in order: repo root **`.env`**, **`backend/.env`**, cwd **`.env`** (later files override).
2. **`initDataSource()`** — connects Postgres, runs **`synchronize`** when `TYPEORM_SYNC` is **`true`** or **unset** (see `config.ts`). **Production:** set **`TYPEORM_SYNC=false`** and use migrations.
3. **`seedAutoReplySettingsIfEmpty(dataSource)`** — ensures **`auto_reply_settings`** row **`id = 1`** exists.
4. **`express()`** — **`cors({ origin: true, credentials: true })`**, **`express.json()`** body parser.
5. **`createServer(app)`** — Node HTTP server.
6. **`new Server(httpServer, { cors: { origin: true, credentials: true, methods: ["GET", "POST"] } })`** — Socket.io CORS mirrors Express (browser clients from any origin with credentials).
7. **`emit = createSocketGateway(io)`** — returns **`RealtimeEmits`** object (all server→client pushes go through this).
8. **`waRef`** — mutable holder so **`createAutoReplyService`** can receive **`getSocket` / `getUserJid`** that delegate to Baileys **after** it is constructed:
   - **`autoReply = createAutoReplyService({ dataSource, getSocket: () => waRef.s?.getSocket() ?? null, getUserJid: () => waRef.s?.getUserJid(), emit })`**
   - **`waRef.s = createBaileysService({ dataSource, emit, autoReply })`**
9. **`mountApi(app, { wa, dataSource, autoReply, emit })`** — mounts router at **`/api`**.
10. **`GET /health`** — `{ ok: true, status: wa.getStatus() }` (not under `/api`).
11. **`httpServer.listen(config.port)`** — default **4000** (`BACKEND_PORT`).

---

## 3. Configuration (`backend/src/config.ts`)

| Variable | Purpose | Default |
|----------|---------|---------|
| **`BACKEND_PORT`** | HTTP + Socket.io listen port | **`4000`** |
| **`DATABASE_URL`** | Postgres connection string | `postgres://postgres:postgres@localhost:5432/wa_automation` |
| **`FRONTEND_ORIGIN`** | Documented / optional CORS hint | `http://localhost:3002` |
| **`TYPEORM_SYNC`** | Schema sync on startup | **`true`** if unset (dev); set **`false`** in production |
| **`LOG_LEVEL`** | Pino log level | `info` |
| **`NODE_ENV`** | If **`development`**, pino-pretty transport for some loggers | — |

**`authDir`:** `backend/auth_info` (resolved from `config.ts` location). Cleared on **logged-out** disconnect and on **`logout()`**.

**`config.autoReply`:** Defaults for **seeding** / env-driven initial settings (see `.env.example`); runtime truth is DB row **`AutoReplySettings` id=1`**.

---

## 4. REST API

All routes below are mounted with prefix **`/api`** (e.g. full path **`GET http://localhost:4000/api/chats`**).

### 4.1 Session

#### `GET /api/session/status`

- **Response:** `{ "status": string }` where **`status`** is internal Baileys service state: **`idle` | `connecting` | `open` | `close`** (and possibly other strings if extended).
- **Side effects:** None.
- **Socket:** None.

#### `POST /api/session/start`

- **Body:** None required.
- **Behavior:** Starts **`connect()`** if no socket, not already connecting, and no reconnect timer waiting. Otherwise returns early success with a **`state`** discriminator.
- **Response JSON (examples):**
  - `{ "ok": true, "state": "created" }` — connection attempt started
  - `{ "ok": true, "state": "already" }` — socket already exists
  - `{ "ok": true, "state": "connecting" }` — already connecting
  - `{ "ok": true, "state": "reconnecting" }` — reconnect timer active
  - `{ "ok": false, "error": "..." }` — **`connect()`** threw before socket setup
- **Socket (async, after response):** During connect, **`emitConnection("connecting")`**, then possibly **`emitQR(qr)`** and **`emitConnection("open")`** or **`emitConnection("close")`** / **`emitConnection("connecting")`** on reconnect paths — see §6.

#### `POST /api/session/logout`

- **Body:** None.
- **Behavior:** Clears reconnect timer, ends/logs out Baileys socket, **`rm(authDir)`**, sets status **`close`**, **`emitConnection("close")`**.
- **Response:** `{ "ok": true }` or `{ "ok": false, "error": "..." }`.
- **Socket:** **`emitConnection("close")`** on success.

---

### 4.2 Chats

#### `GET /api/chats`

- **Response:** `{ "chats": ChatRowPayload[] }` — each element is **`chatToPayload(Chat)`** (`backend/src/db/chat-serialize.ts`): **`jid`**, **`name`**, **`isGroup`**, **`lastMessageAt`** (ISO string or null), **`unreadCount`**, **`updatedAt`**, **`lastMessageBody`**, **`lastMessageType`**, **`lastMessageFromMe`**, **`lastSenderName`**.
- **Ordering:** **`lastMessageAt DESC`** (TypeORM `find`); chats with null last message sort together at backend discretion.
- **Socket:** None.

#### `POST /api/chats/:jid/read`

- **Path param **`jid`****: Express provides **decoded** string; clients should **`encodeURIComponent(jid)`** when **`@`** or other reserved characters appear (e.g. `...%40s.whatsapp.net`).
- **Behavior:** Loads **`Chat`** by **`jid`**. If missing → **404** `{ "error": "Chat not found" }`. Else sets **`unreadCount = 0`**, **`save`**, then **`emit.emitChatUpdated(chatToPayload(row))`**.
- **Response:** **`200`** `{ "ok": true }`.
- **Socket:** **`chat:updated`** with full row (see §6.2).

---

### 4.3 Messages

#### `GET /api/messages`

| Query | Type | Default | Max | Purpose |
|-------|------|---------|-----|---------|
| **`limit`** | integer | 50 | 200 | Page size |
| **`remoteJid`** | string | — | — | If set, filter **`m.remoteJid = remoteJid`** |
| **`before`** | string | — | — | If set, **`messageTimestampMs < before`** (cursor for older pages) |

- **Ordering:** **`messageTimestampMs DESC`**, tie-break **`id ASC`**.
- **Response:** `{ "messages": MessageDto[] }` — shape from **`serializeMessage`** in `routes.ts` (includes **`intent`**, **`matchedMatch`**, ISO **`createdAt`**).
- **Socket:** None.

#### `POST /api/messages/send`

- **Body JSON:** **`{ "jid": string, "text": string }`**
  - **`jid`**: required, trimmed; if empty → **400** `{ "error": "jid is required" }`.
  - **`text`**: passed to Baileys; empty after trim fails inside **`sendText`**.
- **Behavior:** **`wa.sendText(jid, text)`** → requires live Baileys socket; calls **`sock.sendMessage(jid, { text: trimmed })`**. The outbound message comes back through WhatsApp as **`messages.upsert`** and is persisted like any other message (same **`persistMessage`** path → **`message:new`** + **`chat:updated`** unless history-only flags).
- **Response:** **`200`** `{ "ok": true }` or **400** `{ "ok": false, "error": "..." }` (**`Not connected`**, **`Empty message`**, or WhatsApp/Baileys error string).
- **Socket:** None directly from route; indirect via Baileys echo.

---

### 4.4 Auto-reply settings

#### `GET /api/settings`

- **Response:** Serialized **`AutoReplySettings`** (enabled flags, matches, **`matchReplies`**, **`replyText`**, **`cooldownMinutes`**, **`replyExclusions`**, **`updatedAt`**).
- **Socket:** None.

#### `PATCH /api/settings`

- **Body:** Partial object; only documented keys are applied (booleans, **`matchReplies`** object of string values, **`matches`** string array, **`replyText`**, **`cooldownMinutes`** 1–1000, **`replyExclusions`** array of **`{ name, value }`**).
- **Behavior:** Loads row **`id=1`**, mutates, **`syncMatchLabelsWithReplies`**, **`save`**, **`autoReply.invalidateSettingsCache()`**, reloads settings, **`emit.emitSettingsUpdated(serializeSettings(fresh))`**, returns fresh JSON.
- **Socket:** **`settings:updated`** (see §6.2).

---

### 4.5 Auto-reply log (read-only)

#### `GET /api/auto-replies`

- **Query **`limit`****:** 1–200, default **50**.
- **Response:** `{ "log": AutoReplyLog[] }` ordered **`sentAt DESC`**.
- **Socket:** None.

---

### 4.6 Health (outside `/api`)

#### `GET /health`

- **Response:** `{ "ok": true, "status": "<wa.getStatus()>" }`.
- **Use:** Load balancers / k8s probes.

---

## 5. Socket.io — transport and rooms

### 5.1 Server creation

- **Engine:** Attached to **`http.createServer(app)`**.
- **CORS:** **`origin: true`**, **`credentials: true`**, **`methods: ["GET", "POST"]`** (handshake + polling).

### 5.2 Client → server events (`createSocketGateway`)

Registered on **`io.on("connection", (socket) => { ... })`**:

| Event | Payload | Validation | Action |
|-------|---------|------------|--------|
| **`join:chat`** | **`jid`** (any) | `typeof jid === "string" && jid` truthy | **`socket.join("chat:" + jid)`** — async join, **`void`** fire-and-forget |
| **`leave:chat`** | **`jid`** | same | **`socket.leave("chat:" + jid)`** |

**Room name format:** **`chat:`** + exact **`jid`** string (e.g. **`chat:1203...@s.whatsapp.net`**). Rooms are **created implicitly** on first join.

**No authentication** on socket connections in this codebase: any client that can reach the server can connect and receive broadcasts (deploy behind network controls / auth as needed).

### 5.3 Server → client — summary table

All emissions use the **`RealtimeEmits`** object returned by **`createSocketGateway`**.

| Method | Socket.io event name | Targets | Payload shape |
|--------|----------------------|---------|----------------|
| **`emitQR`** | **`qr`** | **`io.emit`** (all sockets) | `{ qr: string }` — raw QR string for client to render |
| **`emitConnection`** | **`connection:state`** | all | `{ state: "connecting" \| "open" \| "close" }` |
| **`emitMessage`** | **`message:new`** | **all** + **`io.to("chat:" + jid)`** | **`MessagePayload`** (see §5.4) |
| **`emitChatUpdated`** | **`chat:updated`** | all | **`ChatRowPayload`** |
| **`emitSettingsUpdated`** | **`settings:updated`** | all | **`Record<string, unknown>`** (serialized settings) |
| **`emitAutoReplySent`** | **`auto-reply:sent`** | all | `{ counterpartyJid, sourceMessageId?, sourceRemoteJid? }` |

### 5.4 **`emitMessage` — double delivery detail**

```typescript
emitMessage(jid: string, payload: MessagePayload) {
  io.emit("message:new", payload);
  io.to(`chat:${jid}`).emit("message:new", payload);
}
```

- **Every** connected socket receives **`message:new`** once via **`io.emit`**.
- **Additionally**, every socket that has **`join:chat`**’d that **`jid`** receives the **same** event **again** via the room emit (Socket.io delivers room broadcasts to members of that room).

**Implication for clients:** If the UI listens globally **and** in a room, it **must deduplicate** by **`(remoteJid, id, fromMe)`** (or equivalent). The dashboard’s **`ConversationView`** only handles one stream logically by deduping; **`Dashboard`** does not attach a second global **`message:new`** handler for the same row.

**`MessagePayload`** (`socket.gateway.ts`): **`id`**, **`remoteJid`**, **`fromMe`**, **`participant`**, **`remoteJidAlt`**, **`participantAlt`**, **`pushName`**, **`messageType`**, **`body`**, **`messageTimestampMs`** (string), **`createdAt`** (ISO), **`intent`**, **`matchedMatch`**.

### 5.5 **`emitChatUpdated` — no room scoping**

```typescript
emitChatUpdated(chat: ChatRowPayload) {
  io.emit("chat:updated", chat);
}
```

- **Only** a global broadcast — **not** sent to **`chat:${jid}`** rooms. Any open client receives every chat row update; the client merges by **`jid`**.

---

## 6. When each socket event fires (complete triggers)

### 6.1 **`qr`**

| Trigger | Emitter | Notes |
|---------|---------|--------|
| Baileys **`connection.update`** provides **`qr`** string | **`emit.emitQR(qr)`** | Fires whenever WA wants a new QR (e.g. refresh). Also logged to terminal as UTF-8 ASCII QR via **`qrcode`** package. |

### 6.2 **`connection:state`**

| Trigger | **`state`** | Notes |
|---------|-------------|--------|
| **`connect()`** begins (after guards) | **`connecting`** | Before **`makeWASocket`** completes |
| Baileys **`connection.update`** → **`connection === "open"`** | **`open`** | Session linked |
| Logged out disconnect (**`DisconnectReason.loggedOut`**) | **`close`** | Auth dir wiped, socket nulled |
| Other disconnect | **`connecting`** | Reconnect scheduled **3s** |
| **`connect()`** catch block | **`close`** | Failed to establish |
| **`logout()`** success | **`close`** | |

### 6.3 **`message:new`**

| Trigger | Source path | Notes |
|---------|-------------|--------|
| After **`Message`** upsert + reload **`saved`** in **`persistMessage`** | **`emit.emitMessage(chatJid, toPayload(saved))`** | **`chatJid`** from **`mapWAMessageToEntity`** ( **`key.remoteJid`** ). Only if **`saved`** row exists. **`toPayload`** maps DB entity to **`MessagePayload`**. |
| Same path for **incoming**, **history sync**, **outgoing** (including **`sendText`** echo) | same | **`doAutoReply`** is **`true`** only for **`messages.upsert`** with **`type === "notify"`** — does not change socket emit |

**Order inside `persistMessage`:** Transaction (message + chat upsert) → **`emitMessage`** → **`emitChatUpdated`** (unless **`skipChatEmit`**) → **`maybeAutoReply`** (if **`doAutoReply && saved`**). So clients see **`message:new`** before **`chat:updated`** for the same persistence tick; auto-reply runs **after** both emits for that message.

### 6.4 **`chat:updated`**

| Trigger | Notes |
|---------|--------|
| End of **`persistMessage`** when **`!skipChatEmit`** | Reloads **`Chat`** row after transaction, **`chatToPayload`**, **`emitChatUpdated`** |
| **`handleHistoryMessages`** | Each message uses **`skipChatEmit: true`** — **no** **`chat:updated`** per history message (avoids flood). Clients refresh chats on **`connection:open`** refetch. |
| **`emitChatIfPresent(jid)`** after **`chats.upsert`**, **`groups.upsert`**, contact **`insert`** path | Metadata / list alignment |
| **`applyContactDisplay`** after **`save`** or after **`insert` + find** | Name fill for contacts |
| **`groups.update`** after **`save`** | Subject change |
| **`POST /api/chats/:jid/read`** | After **`unreadCount = 0`** |

### 6.5 **`settings:updated`**

| Trigger | Notes |
|---------|--------|
| **`PATCH /api/settings`** success | Payload = **`serializeSettings(fresh)`** cast to **`Record<string, unknown>`** |

### 6.6 **`auto-reply:sent`**

| Trigger | Notes |
|---------|--------|
| **`maybeAutoReply`** after successful **`sendMessage`**, **`AutoReplyLog`** **`save`** | **`emit.emitAutoReplySent({ counterpartyJid: target, sourceMessageId, sourceRemoteJid })`** — **`target`** is DM JID (participant in groups, **`remoteJid`** in 1:1). Not emitted if send throws or any guard short-circuits. |

---

## 7. Baileys service (`baileys.service.ts`) — data flow

### 7.1 Public API

| Method | Behavior |
|--------|----------|
| **`getSocket()`** | Current **`WASocket`** or **`null`** |
| **`getUserJid()`** | **`socket?.user?.id`** |
| **`getStatus()`** | **`idle` \| `connecting` \| `open` \| `close`** |
| **`start()`** | Starts **`connect()`** or returns status object without throwing for common “already there” cases |
| **`logout()`** | Ends session, deletes auth, **`emitConnection("close")`** |
| **`sendText(jid, text)`** | Requires socket; **`sendMessage`** with trimmed text |

### 7.2 Baileys event wiring (socket-relevant)

| Baileys event | Handler effect | Socket |
|---------------|----------------|--------|
| **`creds.update`** | **`saveCreds`** | — |
| **`messages.upsert`** | **`persistMessage(m, { doAutoReply: type === "notify" })`** | **`message:new`**, **`chat:updated`** per §6 |
| **`messaging-history.set`** | Contacts from **`histContacts`** → **`applyContactDisplay`**; messages → **`handleHistoryMessages`** (**`skipChatEmit`**) | **`chat:updated`** only from contact paths / not from bulk message persist |
| **`chats.upsert`** | Upsert **`Chat`**, optional **`groupMetadata`** for name | **`chat:updated`** via **`emitChatIfPresent`** |
| **`contacts.upsert` / `contacts.update`** | **`applyContactDisplay`** | **`chat:updated`** when row changes |
| **`groups.upsert`** | Upsert group **`Chat`** | **`chat:updated`** |
| **`groups.update`** | Partial metadata with **`subject`** | **`chat:updated`** |
| **`connection.update`** | QR + open/close/reconnect | **`qr`**, **`connection:state`** |

### 7.3 `persistMessage` — DB + unread + preview

1. Skip if missing **`key.id`** or **`key.remoteJid`**.
2. **`mapWAMessageToEntity`** → **`Message`** entity + **`chatJid`**.
3. **`autoReply.applyClassificationToMessage(me)`** — sets **`intent`**, **`matchedMatch`** on entity (in memory; persisted in upsert).
4. Load existing **`Chat`** for **`chatJid`**; compute **`nextUnread`**: increment if **`!fromMe`**, else keep.
5. **Transaction:** **`Message` upsert** (conflict **`id`, `remoteJid`, `fromMe`**), **`Chat` upsert** with preview fields from **`previewFromMessage`** (**`lastMessageBody`** truncated to 512 chars with **`…`**, **`lastMessageType`**, **`lastMessageFromMe`**, **`lastSenderName`** = **`pushName`** for incoming).
6. Reload **`saved`** **`Message`**; **`emitMessage`**, optional **`emitChatUpdated`**, optional **`maybeAutoReply`**.

### 7.4 `applyContactDisplay`

- Skips if no display string.
- If chat exists **and** already has non-empty **`name`**, **no-op** (does not overwrite custom names).
- Else update or **insert** minimal **`Chat`** row, then **`emitChatUpdated`**.

---

## 8. Auto-reply service (`auto-reply.service.ts`) — socket + Baileys

- **Injected **`emit`****:** Only **`emitAutoReplySent`** is used.
- **`maybeAutoReply(wam, me)`** runs **after** **`persistMessage`** has emitted **`message:new`** / **`chat:updated`** for that message.
- **Guards:** not from me; **`matchedMatch`** set; settings enabled; match in list; intent / buy / sell rules; **`replyText`** non-empty; **`resolveCounterpartyJid`**; not group/broadcast JID; not self; not excluded; not on cooldown; socket present.
- **Send:** **`sock.sendMessage(target, { text }, isGroupSource ? { quoted: wam } : undefined)`** — group replies quote the original message.
- **On success:** **`AutoReplyLog`** row, **`emitAutoReplySent`**.

---

## 9. Persistence layer

### 9.1 Entities (high level)

- **`Message`**: composite PK **`(id, remoteJid, fromMe)`**; **`messageTimestampMs`** as string bigint in TS; **`rawJson`** jsonb; **`intent`**, **`matchedMatch`** for classifier.
- **`Chat`**: PK **`jid`**; preview columns + **`unreadCount`**; **`updatedAt`** auto.
- **`AutoReplySettings`**: singleton row **`id = 1`**.
- **`AutoReplyLog`**: append-only send audit.

### 9.2 Indexes

- **`messages`:** **`(remoteJid, messageTimestampMs)`** for per-chat history queries.

---

## 10. Serialization helpers

- **`serializeMessage`** (`routes.ts`): API JSON for **`Message`** rows.
- **`serializeSettings`** (`routes.ts`): API JSON for settings.
- **`chatToPayload`** (`chat-serialize.ts`): **`Chat` → `ChatRowPayload`** for REST **`GET /chats`** and socket **`chat:updated`**.

---

## 11. Error and edge cases (API + sockets)

- **`sendText`**: Returns **`{ ok: false, error }`** without throwing; route maps to HTTP 400.
- **`POST /api/chats/:jid/read`**: **404** if chat never created in DB (e.g. typo JID).
- **Socket reconnect:** Client Socket.io reconnects; server may re-emit **`connection:state`** when Baileys reconnects; **`join:chat`** must be re-sent by client after reconnect if room-scoped delivery matters (global **`message:new`** still reaches all clients).
- **History flood:** **`skipChatEmit`** prevents **`chat:updated`** spam; list may be stale until **`GET /chats`** after open or subsequent live messages.

---

## 12. File map (backend)

| Path | Role |
|------|------|
| **`src/index.ts`** | Boot: DB, Express, Socket.io, **`waRef`**, mount routes, listen |
| **`src/config.ts`** | Env, **`authDir`**, DB URL, TypeORM sync flag |
| **`src/api/routes.ts`** | All **`/api`** routes; **`emit`** for settings + read |
| **`src/realtime/socket.gateway.ts`** | **`createSocketGateway`**, **`MessagePayload`**, **`ChatRowPayload`**, **`join:chat` / `leave:chat`** |
| **`src/whatsapp/baileys.service.ts`** | Baileys lifecycle, **`persistMessage`**, **`sendText`**, most **`emit*`** calls |
| **`src/whatsapp/auto-reply.service.ts`** | Classification, **`maybeAutoReply`**, **`emitAutoReplySent`** |
| **`src/whatsapp/message-mapper.ts`** | **`WAMessage` → `Message`** + **`chatJid`** |
| **`src/db/data-source.ts`** | TypeORM **`DataSource`**
| **`src/db/entities/*.ts`** | Entities |
| **`src/db/chat-serialize.ts`** | **`chatToPayload`**
| **`src/db/seed-auto-reply.ts`** | Initial settings row |

---

## 13. Cross-reference

- **Frontend** socket client: `frontend/lib/socket.ts` — same **`apiBase()`** host, path **`/socket.io/`**.
- **Product / UI flows:** [`design.md`](./design.md).
