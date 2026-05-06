import { rm } from "node:fs/promises";
import { type Boom } from "@hapi/boom";
import makeWASocket, {
  Browsers,
  DisconnectReason,
  fetchLatestBaileysVersion,
  proto,
  toNumber,
  useMultiFileAuthState,
  type Chat as BaileysWAChat,
  type Contact,
  type GroupMetadata,
  type WAMessage,
} from "baileys";
import pino from "pino";
import type { DataSource } from "typeorm";
import type { MessagePayload } from "../realtime/socket.gateway.js";
import type { RealtimeEmits } from "../realtime/socket.gateway.js";
import { authDir } from "../config.js";
import { Message } from "../db/entities/Message.js";
import { Chat } from "../db/entities/Chat.js";
import { chatToPayload } from "../db/chat-serialize.js";
import { mapWAMessageToEntity, wamessageToStorableJson } from "./message-mapper.js";
import * as qrcode from "qrcode";
import type { createAutoReplyService } from "./auto-reply.service.js";

const baileysLogger = pino({ level: "silent" });
const appLogger = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

function errMessage(e: unknown) {
  return e instanceof Error ? e.message : String(e);
}

function jidIsGroup(jid: string): boolean {
  return jid.endsWith("@g.us");
}

function contactDisplayName(c: {
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
}): string | null {
  const n = c.name?.trim() || c.notify?.trim() || c.verifiedName?.trim();
  return n || null;
}

function previewFromMessage(me: Message): {
  body: string;
  type: string;
  fromMe: boolean;
  sender: string | null;
} {
  const rawBody =
    me.body != null && String(me.body).trim().length > 0
      ? String(me.body).trim()
      : `(${me.messageType})`;
  const body = rawBody.length > 512 ? `${rawBody.slice(0, 509)}…` : rawBody;
  return {
    body,
    type: me.messageType,
    fromMe: me.fromMe,
    sender: me.fromMe ? null : (me.pushName?.trim() || null),
  };
}

function toPayload(m: Message): MessagePayload {
  return {
    id: m.id,
    remoteJid: m.remoteJid,
    fromMe: m.fromMe,
    participant: m.participant ?? null,
    remoteJidAlt: m.remoteJidAlt ?? null,
    participantAlt: m.participantAlt ?? null,
    pushName: m.pushName ?? null,
    messageType: m.messageType,
    body: m.body ?? null,
    messageTimestampMs: m.messageTimestampMs,
    createdAt: m.createdAt.toISOString(),
    intent: m.intent ?? null,
    matchedMatch: m.matchedMatch ?? null,
  };
}

type WASocketT = Awaited<ReturnType<typeof makeWASocket>>;

type AutoReply = ReturnType<typeof createAutoReplyService>;

/**
 * Create Baileys session + message persistence. Single session for this app.
 */
export function createBaileysService(opts: {
  dataSource: DataSource;
  emit: RealtimeEmits;
  autoReply: AutoReply;
}) {
  const { dataSource, emit, autoReply } = opts;
  const msgRepo = () => dataSource.getRepository(Message);
  const chatRepo = () => dataSource.getRepository(Chat);

  let socket: WASocketT | null = null;
  let isConnecting = false;
  let sessionStatus: "idle" | "connecting" | "open" | "close" = "idle";
  let reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  function setSessionStatus(s: "idle" | "connecting" | "open" | "close") {
    sessionStatus = s;
  }

  async function persistMessage(
    m: WAMessage,
    opts: { doAutoReply?: boolean; skipChatEmit?: boolean } = {},
  ) {
    if (!m.key?.id || !m.key?.remoteJid) {
      return;
    }
    const raw = wamessageToStorableJson(m) as Record<string, unknown>;
    const { message: me, chatJid } = mapWAMessageToEntity(m, raw);
    await autoReply.applyClassificationToMessage(me);
    const existing = await chatRepo().findOne({ where: { jid: chatJid } });
    const fromMe = me.fromMe;
    const nextUnread = !fromMe
      ? (existing?.unreadCount ?? 0) + 1
      : (existing?.unreadCount ?? 0);
    const preview = previewFromMessage(me);

    await dataSource.transaction(async (em) => {
      const M = em.getRepository(Message);
      const C = em.getRepository(Chat);
      // TypeORM deep-partial for jsonb is overly strict here
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await M.upsert({ ...me } as any, { conflictPaths: ["id", "remoteJid", "fromMe"] });
      const ts = new Date(Number(me.messageTimestampMs));
      await C.upsert(
        {
          jid: chatJid,
          name: existing?.name ?? null,
          isGroup: jidIsGroup(chatJid),
          lastMessageAt: ts,
          unreadCount: nextUnread,
          lastMessageBody: preview.body,
          lastMessageType: preview.type,
          lastMessageFromMe: preview.fromMe,
          lastSenderName: preview.sender,
        },
        { conflictPaths: ["jid"] },
      );
    });

    const saved = await msgRepo().findOne({
      where: { id: me.id, remoteJid: me.remoteJid, fromMe: me.fromMe },
    });
    if (saved) {
      emit.emitMessage(chatJid, toPayload(saved));
    }
    if (!opts.skipChatEmit) {
      const chatRow = await chatRepo().findOne({ where: { jid: chatJid } });
      if (chatRow) {
        emit.emitChatUpdated(chatToPayload(chatRow));
      }
    }
    if (opts.doAutoReply && saved) {
      await autoReply.maybeAutoReply(m, saved);
    }
  }

  async function emitChatIfPresent(jid: string) {
    const row = await chatRepo().findOne({ where: { jid } });
    if (row) emit.emitChatUpdated(chatToPayload(row));
  }

  async function applyContactDisplay(jid: string, display: string | null) {
    if (!display?.trim()) return;
    const existing = await chatRepo().findOne({ where: { jid } });
    if (existing?.name?.trim()) return;
    if (existing) {
      existing.name = display.trim();
      existing.isGroup = jidIsGroup(jid);
      await chatRepo().save(existing);
      emit.emitChatUpdated(chatToPayload(existing));
      return;
    }
    await chatRepo().insert({
      jid,
      name: display.trim(),
      isGroup: jidIsGroup(jid),
      unreadCount: 0,
      lastMessageAt: null,
      lastMessageBody: null,
      lastMessageType: null,
      lastMessageFromMe: null,
      lastSenderName: null,
    });
    await emitChatIfPresent(jid);
  }

  async function handleHistoryMessages(msgs: WAMessage[]) {
    for (const m of msgs) {
      try {
        await persistMessage(m, { skipChatEmit: true });
      } catch (e) {
        appLogger.error({ err: e }, "persist (history) failed");
      }
    }
  }

  const connect = async () => {
    if (isConnecting) return;
    isConnecting = true;
    if (reconnectTimer) {
      clearTimeout(reconnectTimer);
      reconnectTimer = null;
    }

    if (socket) {
      isConnecting = false;
      return;
    }

    setSessionStatus("connecting");
    emit.emitConnection("connecting");

    try {
      const { state, saveCreds } = await useMultiFileAuthState(authDir);
      const { version } = await fetchLatestBaileysVersion();

      const s = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: true,
        logger: baileysLogger,
        getMessage: async () => {
          return undefined;
        },
        shouldSyncHistoryMessage: (_n: proto.Message.IHistorySyncNotification) => {
          return true;
        },
      });
      socket = s;

      s.ev.on("creds.update", saveCreds);

      s.ev.on("messages.upsert", async (u) => {
        const { messages, type } = u;
        const doAutoReply = type === "notify";
        for (const m of messages) {
          try {
            await persistMessage(m, { doAutoReply });
          } catch (e) {
            appLogger.error({ err: e }, "persist (upsert) failed");
          }
        }
      });

      s.ev.on("messaging-history.set", async ({ messages: hist, contacts: histContacts }) => {
        if (histContacts?.length) {
          for (const c of histContacts) {
            const jid = c.id;
            if (!jid) continue;
            const display = contactDisplayName(c);
            try {
              await applyContactDisplay(jid, display);
            } catch (e) {
              appLogger.error({ err: e }, "history contact upsert failed");
            }
          }
        }
        if (hist?.length) {
          await handleHistoryMessages(hist);
        }
      });

      s.ev.on("chats.upsert", (chatsArg: BaileysWAChat[]) => {
        void (async () => {
          for (const bc of chatsArg) {
            const jid = bc.id;
            if (!jid) continue;
            const existing = await chatRepo().findOne({ where: { jid } });
            const cTs = bc.conversationTimestamp;
            const last =
              cTs != null
                ? new Date(toNumber(cTs) * 1000)
                : (existing?.lastMessageAt ?? null);
            let name = (bc as { name?: string | null }).name ?? existing?.name ?? null;
            if (jidIsGroup(jid) && !name?.trim()) {
              try {
                const meta = await s.groupMetadata(jid);
                if (meta?.subject) name = meta.subject;
              } catch {
                // ignore — group metadata may be unavailable briefly
              }
            }
            await chatRepo().upsert(
              {
                jid,
                name,
                isGroup: jidIsGroup(jid),
                lastMessageAt: last,
                unreadCount: existing?.unreadCount ?? 0,
                lastMessageBody: existing?.lastMessageBody ?? null,
                lastMessageType: existing?.lastMessageType ?? null,
                lastMessageFromMe: existing?.lastMessageFromMe ?? null,
                lastSenderName: existing?.lastSenderName ?? null,
              },
              { conflictPaths: ["jid"] },
            );
            await emitChatIfPresent(jid);
          }
        })();
      });

      s.ev.on("contacts.upsert", (contacts: Contact[]) => {
        void (async () => {
          for (const c of contacts) {
            const jid = c.id;
            if (!jid) continue;
            try {
              await applyContactDisplay(jid, contactDisplayName(c));
            } catch (e) {
              appLogger.error({ err: e }, "contacts.upsert failed");
            }
          }
        })();
      });

      s.ev.on("contacts.update", (contacts: Partial<Contact>[]) => {
        void (async () => {
          for (const c of contacts) {
            const jid = c.id;
            if (!jid) continue;
            const display = contactDisplayName(c);
            if (!display) continue;
            try {
              await applyContactDisplay(jid, display);
            } catch (e) {
              appLogger.error({ err: e }, "contacts.update failed");
            }
          }
        })();
      });

      s.ev.on("groups.upsert", (groups: GroupMetadata[]) => {
        void (async () => {
          for (const g of groups) {
            const jid = g.id;
            if (!jid) continue;
            const existing = await chatRepo().findOne({ where: { jid } });
            await chatRepo().upsert(
              {
                jid,
                name: g.subject,
                isGroup: true,
                lastMessageAt: existing?.lastMessageAt ?? null,
                unreadCount: existing?.unreadCount ?? 0,
                lastMessageBody: existing?.lastMessageBody ?? null,
                lastMessageType: existing?.lastMessageType ?? null,
                lastMessageFromMe: existing?.lastMessageFromMe ?? null,
                lastSenderName: existing?.lastSenderName ?? null,
              },
              { conflictPaths: ["jid"] },
            );
            await emitChatIfPresent(jid);
          }
        })();
      });

      s.ev.on("groups.update", (updates: Partial<GroupMetadata>[]) => {
        void (async () => {
          for (const u of updates) {
            const jid = u.id;
            if (!jid || u.subject == null) continue;
            const row = await chatRepo().findOne({ where: { jid } });
            if (!row) continue;
            row.name = u.subject;
            row.isGroup = true;
            await chatRepo().save(row);
            emit.emitChatUpdated(chatToPayload(row));
          }
        })();
      });

      s.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          emit.emitQR(qr);
          void qrcode
            .toString(qr, { type: "utf8" })
            .then((ascii) => {
              appLogger.info("QR in terminal (UTF-8):\n" + ascii);
            })
            .catch(() => {
              // ignore
            });
        }

        if (connection === "open") {
          setSessionStatus("open");
          emit.emitConnection("open");
        }

        if (connection === "close") {
          setSessionStatus("close");
          const boom = lastDisconnect?.error as Boom | undefined;
          const code = boom?.output?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;
          if (loggedOut) {
            void rm(authDir, { recursive: true, force: true }).catch(() => {
              // ignore
            });
            socket = null;
            emit.emitConnection("close");
          } else {
            socket = null;
            emit.emitConnection("connecting");
            reconnectTimer = setTimeout(() => {
              void connect();
            }, 3_000);
          }
        }
      });
    } catch (e) {
      appLogger.error(e, "connect failed");
      setSessionStatus("close");
      emit.emitConnection("close");
    } finally {
      isConnecting = false;
    }
  };

  return {
    getSocket: () => socket,
    getUserJid: () => socket?.user?.id,
    getStatus: () => sessionStatus,

    async start() {
      if (reconnectTimer) {
        return { ok: true as const, state: "reconnecting" as const };
      }
      if (isConnecting) {
        return { ok: true as const, state: "connecting" as const };
      }
      if (socket) {
        return { ok: true as const, state: "already" as const };
      }
      try {
        await connect();
        return { ok: true as const, state: "created" as const };
      } catch (e) {
        return { ok: false as const, error: errMessage(e) };
      }
    },

    async logout() {
      if (reconnectTimer) {
        clearTimeout(reconnectTimer);
        reconnectTimer = null;
      }
      try {
        if (socket) {
          if (typeof socket.logout === "function") {
            await socket.logout();
          } else {
            (socket as { end: (r: undefined) => void }).end(undefined);
          }
        }
        socket = null;
        await rm(authDir, { recursive: true, force: true });
        setSessionStatus("close");
        emit.emitConnection("close");
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: errMessage(e) };
      }
    },

    async sendText(jid: string, text: string) {
      const sock = socket;
      if (!sock) {
        return { ok: false as const, error: "Not connected" };
      }
      const trimmed = text.trim();
      if (!trimmed) {
        return { ok: false as const, error: "Empty message" };
      }
      try {
        await sock.sendMessage(jid, { text: trimmed });
        return { ok: true as const };
      } catch (e) {
        return { ok: false as const, error: errMessage(e) };
      }
    },
  };
}
