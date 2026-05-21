import path from "node:path";
import { rm, mkdir, rename, readdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import { type Boom } from "@hapi/boom";
import makeWASocket, {
  BufferJSON,
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
import type {
  ClassifiedMessagePayload,
  RealtimeEmits,
} from "../realtime/socket.gateway.js";
import { authInfoRoot } from "../config.js";
import { Message } from "../db/entities/Message.js";
import { Chat } from "../db/entities/Chat.js";
import { chatToPayload } from "../db/chat-serialize.js";
import { mapWAMessageToEntity, wamessageToStorableJson } from "./message-mapper.js";
import * as qrcode from "qrcode";
import type { createAutoReplyService } from "./auto-reply.service.js";
import type { createClassificationService } from "./classification.service.js";
import type { WhatsAppConnection } from "./connection.js";
import {
  contactDisplayName,
  jidIsGroup,
  messageToPayload,
  previewFromMessage,
} from "./baileys-utils.js";

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

type WASocketT = Awaited<ReturnType<typeof makeWASocket>>;
type AutoReply = ReturnType<typeof createAutoReplyService>;
type Classification = ReturnType<typeof createClassificationService>;

export class BaileysConnection implements WhatsAppConnection {
  readonly accountId: string;
  readonly type = "baileys" as const;

  private readonly authDir: string;
  private readonly dataSource: DataSource;
  private readonly emit: RealtimeEmits;
  private readonly autoReply: AutoReply;
  private readonly classification: Classification;

  private socket: WASocketT | null = null;
  private isConnecting = false;
  private sessionStatus: "idle" | "connecting" | "open" | "close" = "idle";
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(opts: {
    accountId: string;
    authDirSlug: string;
    dataSource: DataSource;
    emit: RealtimeEmits;
    autoReply: AutoReply;
    classification: Classification;
  }) {
    this.accountId = opts.accountId;
    this.authDir = path.join(authInfoRoot, opts.authDirSlug);
    this.dataSource = opts.dataSource;
    this.emit = opts.emit;
    this.autoReply = opts.autoReply;
    this.classification = opts.classification;
  }

  private msgRepo() {
    return this.dataSource.getRepository(Message);
  }

  private chatRepo() {
    return this.dataSource.getRepository(Chat);
  }

  private setSessionStatus(s: "idle" | "connecting" | "open" | "close") {
    this.sessionStatus = s;
  }

  private async persistMessage(
    m: WAMessage,
    opts: { doAutoReply?: boolean; skipChatEmit?: boolean } = {},
  ) {
    if (!m.key?.id || !m.key?.remoteJid) {
      return;
    }
    const accountId = this.accountId;
    const raw = wamessageToStorableJson(m) as Record<string, unknown>;
    const { message: me, chatJid } = mapWAMessageToEntity(m, raw);
    await this.autoReply.applyClassificationToMessage(me);
    const existing = await this.chatRepo().findOne({ where: { accountId, jid: chatJid } });
    const fromMe = me.fromMe;
    const nextUnread = !fromMe
      ? (existing?.unreadCount ?? 0) + 1
      : (existing?.unreadCount ?? 0);
    const preview = previewFromMessage(me);

    let classifiedPayload: ClassifiedMessagePayload | null = null;

    await this.dataSource.transaction(async (em) => {
      const M = em.getRepository(Message);
      const C = em.getRepository(Chat);
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      await M.upsert({ ...me, accountId, provider: "baileys" } as any, {
        conflictPaths: ["accountId", "id", "remoteJid", "fromMe"],
      });
      const ts = new Date(Number(me.messageTimestampMs));
      await C.upsert(
        {
          accountId,
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
        { conflictPaths: ["accountId", "jid"] },
      );
      const chatRow = await C.findOne({ where: { accountId, jid: chatJid } });
      classifiedPayload = await this.classification.upsertInTransaction(em, { ...me, accountId }, chatRow);
    });

    const saved = await this.msgRepo().findOne({
      where: { accountId, id: me.id, remoteJid: me.remoteJid, fromMe: me.fromMe },
    });
    if (saved) {
      this.emit.emitMessage(accountId, chatJid, messageToPayload(accountId, saved));
    }
    if (classifiedPayload) {
      this.emit.emitMessageClassified(accountId, chatJid, classifiedPayload);
    }
    if (!opts.skipChatEmit) {
      const chatRow = await this.chatRepo().findOne({ where: { accountId, jid: chatJid } });
      if (chatRow) {
        this.emit.emitChatUpdated(chatToPayload(chatRow));
      }
    }
    if (opts.doAutoReply && saved) {
      await this.autoReply.maybeAutoReply(m, saved, this);
    }
  }

  private async emitChatIfPresent(jid: string) {
    const row = await this.chatRepo().findOne({ where: { accountId: this.accountId, jid } });
    if (row) this.emit.emitChatUpdated(chatToPayload(row));
  }

  private async applyContactDisplay(jid: string, display: string | null) {
    if (!display?.trim()) return;
    const name = display.trim().slice(0, 510);
    const accountId = this.accountId;
    const existing = await this.chatRepo().findOne({ where: { accountId, jid } });
    if (existing?.name?.trim()) return;
    if (existing) {
      existing.name = name;
      existing.isGroup = jidIsGroup(jid);
      await this.chatRepo().save(existing);
      this.emit.emitChatUpdated(chatToPayload(existing));
      return;
    }
    await this.chatRepo().insert({
      accountId,
      jid,
      name,
      isGroup: jidIsGroup(jid),
      unreadCount: 0,
      lastMessageAt: null,
      lastMessageBody: null,
      lastMessageType: null,
      lastMessageFromMe: null,
      lastSenderName: null,
    });
    await this.emitChatIfPresent(jid);
  }

  private async handleHistoryMessages(msgs: WAMessage[]) {
    for (const m of msgs) {
      try {
        await this.persistMessage(m, { skipChatEmit: true });
      } catch (e) {
        appLogger.error({ err: e }, "persist (history) failed");
      }
    }
  }

  async connect(): Promise<void> {
    if (this.isConnecting) return;
    this.isConnecting = true;
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }

    if (this.socket) {
      this.isConnecting = false;
      return;
    }

    this.setSessionStatus("connecting");
    this.emit.emitConnection(this.accountId, "connecting");

    try {
      await mkdir(this.authDir, { recursive: true });
      const { state, saveCreds } = await useMultiFileAuthState(this.authDir);
      const { version } = await fetchLatestBaileysVersion();

      const s = makeWASocket({
        version,
        printQRInTerminal: false,
        auth: state,
        browser: Browsers.ubuntu("Chrome"),
        markOnlineOnConnect: true,
        logger: baileysLogger,
        getMessage: async () => undefined,
        shouldSyncHistoryMessage: (_n: proto.Message.IHistorySyncNotification) => true,
      });
      this.socket = s;

      s.ev.on("creds.update", saveCreds);

      s.ev.on("messages.upsert", async (u) => {
        const { messages, type } = u;
        const doAutoReply = type === "notify";
        for (const m of messages) {
          try {
            await this.persistMessage(m, { doAutoReply });
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
            try {
              await this.applyContactDisplay(jid, contactDisplayName(c));
            } catch (e) {
              appLogger.error({ err: e }, "history contact upsert failed");
            }
          }
        }
        if (hist?.length) {
          await this.handleHistoryMessages(hist);
        }
      });

      s.ev.on("chats.upsert", (chatsArg: BaileysWAChat[]) => {
        void (async () => {
          const accountId = this.accountId;
          for (const bc of chatsArg) {
            const jid = bc.id;
            if (!jid) continue;
            const existing = await this.chatRepo().findOne({ where: { accountId, jid } });
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
                // ignore
              }
            }
            await this.chatRepo().upsert(
              {
                accountId,
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
              { conflictPaths: ["accountId", "jid"] },
            );
            await this.emitChatIfPresent(jid);
          }
        })();
      });

      s.ev.on("contacts.upsert", (contacts: Contact[]) => {
        void (async () => {
          for (const c of contacts) {
            const jid = c.id;
            if (!jid) continue;
            try {
              await this.applyContactDisplay(jid, contactDisplayName(c));
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
              await this.applyContactDisplay(jid, display);
            } catch (e) {
              appLogger.error({ err: e }, "contacts.update failed");
            }
          }
        })();
      });

      s.ev.on("groups.upsert", (groups: GroupMetadata[]) => {
        void (async () => {
          const accountId = this.accountId;
          for (const g of groups) {
            const jid = g.id;
            if (!jid) continue;
            const existing = await this.chatRepo().findOne({ where: { accountId, jid } });
            await this.chatRepo().upsert(
              {
                accountId,
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
              { conflictPaths: ["accountId", "jid"] },
            );
            await this.emitChatIfPresent(jid);
          }
        })();
      });

      s.ev.on("groups.update", (updates: Partial<GroupMetadata>[]) => {
        void (async () => {
          const accountId = this.accountId;
          for (const u of updates) {
            const jid = u.id;
            if (!jid || u.subject == null) continue;
            const row = await this.chatRepo().findOne({ where: { accountId, jid } });
            if (!row) continue;
            row.name = u.subject;
            row.isGroup = true;
            await this.chatRepo().save(row);
            this.emit.emitChatUpdated(chatToPayload(row));
          }
        })();
      });

      s.ev.on("connection.update", (update) => {
        const { connection, lastDisconnect, qr } = update;

        if (qr) {
          this.emit.emitQR(this.accountId, qr);
          void qrcode
            .toString(qr, { type: "utf8" })
            .then((ascii) => {
              appLogger.info(`[${this.accountId}] QR in terminal:\n` + ascii);
            })
            .catch(() => undefined);
        }

        if (connection === "open") {
          this.setSessionStatus("open");
          this.emit.emitConnection(this.accountId, "open");
        }

        if (connection === "close") {
          this.setSessionStatus("close");
          const boom = lastDisconnect?.error as Boom | undefined;
          const code = boom?.output?.statusCode;
          const loggedOut = code === DisconnectReason.loggedOut;
          if (loggedOut) {
            void rm(this.authDir, { recursive: true, force: true }).catch(() => undefined);
            this.socket = null;
            this.emit.emitConnection(this.accountId, "close");
          } else {
            this.socket = null;
            this.emit.emitConnection(this.accountId, "connecting");
            this.reconnectTimer = setTimeout(() => {
              void this.connect();
            }, 3_000);
          }
        }
      });
    } catch (e) {
      appLogger.error(e, "connect failed");
      this.setSessionStatus("close");
      this.emit.emitConnection(this.accountId, "close");
    } finally {
      this.isConnecting = false;
    }
  }

  async disconnect(): Promise<void> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    if (this.socket) {
      try {
        (this.socket as { end: (r: undefined) => void }).end(undefined);
      } catch {
        // ignore
      }
      this.socket = null;
    }
    this.setSessionStatus("close");
  }

  async logout(): Promise<{ ok: true } | { ok: false; error: string }> {
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
    try {
      if (this.socket) {
        if (typeof this.socket.logout === "function") {
          await this.socket.logout();
        } else {
          (this.socket as { end: (r: undefined) => void }).end(undefined);
        }
      }
      this.socket = null;
      await rm(this.authDir, { recursive: true, force: true });
      this.setSessionStatus("close");
      this.emit.emitConnection(this.accountId, "close");
      return { ok: true };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  getStatus(): "idle" | "connecting" | "open" | "close" {
    return this.sessionStatus;
  }

  getUserIdentifier(): string | undefined {
    return this.socket?.user?.id;
  }

  getRawSocket() {
    return this.socket;
  }

  canSendFreeformOutsideWindow(): boolean {
    return true;
  }

  canQuoteMessages(): boolean {
    return true;
  }

  canJoinGroups(): boolean {
    return true;
  }

  async start(): Promise<{ ok: true; state: string } | { ok: false; error: string }> {
    if (this.reconnectTimer) return { ok: true, state: "reconnecting" };
    if (this.isConnecting) return { ok: true, state: "connecting" };
    if (this.socket) return { ok: true, state: "already" };
    try {
      await this.connect();
      return { ok: true, state: "created" };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async sendText(
    jid: string,
    text: string,
    opts?: {
      quoted?: { remoteJid: string; messageId: string; fromMe: boolean };
      contextWamid?: string;
    },
  ): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }> {
    const sock = this.socket;
    if (!sock) return { ok: false, error: "Not connected" };
    const trimmed = text.trim();
    if (!trimmed) return { ok: false, error: "Empty message" };

    let quotedWam: WAMessage | undefined;
    if (opts?.quoted) {
      const { remoteJid, messageId, fromMe } = opts.quoted;
      const row = await this.msgRepo().findOne({
        where: { accountId: this.accountId, id: messageId, remoteJid, fromMe },
      });
      if (!row?.rawJson) return { ok: false, error: "Quoted message not found" };
      try {
        quotedWam = JSON.parse(JSON.stringify(row.rawJson), BufferJSON.reviver) as WAMessage;
      } catch (e) {
        return { ok: false, error: `Invalid quoted message: ${errMessage(e)}` };
      }
    }
    try {
      const result = await sock.sendMessage(
        jid,
        { text: trimmed },
        quotedWam ? { quoted: quotedWam } : undefined,
      );
      return { ok: true, providerMessageId: result?.key?.id ?? undefined };
    } catch (e) {
      return { ok: false, error: errMessage(e) };
    }
  }

  async sendTemplate(): Promise<{ ok: false; error: string }> {
    return { ok: false, error: "Templates not supported on Baileys transport" };
  }
}

/**
 * Migrate legacy flat auth_info files into the primary slug subdirectory.
 * Safe to call multiple times — exits early if migration already done.
 */
export async function migrateLegacyAuthInfo(primarySlug: string): Promise<void> {
  const slugDir = path.join(authInfoRoot, primarySlug);
  if (existsSync(slugDir)) return;

  try {
    const files = await readdir(authInfoRoot);
    const legacyFiles = files.filter((f) => !f.startsWith(".") && f !== primarySlug);
    if (legacyFiles.length === 0) return;
    await mkdir(slugDir, { recursive: true });
    for (const f of legacyFiles) {
      await rename(path.join(authInfoRoot, f), path.join(slugDir, f)).catch(() => undefined);
    }
    appLogger.info({ primarySlug }, "Migrated legacy auth_info files to slug subdirectory");
  } catch {
    // If authInfoRoot doesn't exist yet, that's fine — it'll be created on connect
  }
}

/** Factory kept for backward compatibility in Phase 1. */
export function createBaileysService(opts: {
  accountId: string;
  authDirSlug: string;
  dataSource: DataSource;
  emit: RealtimeEmits;
  autoReply: ReturnType<typeof createAutoReplyService>;
  classification: ReturnType<typeof createClassificationService>;
}): BaileysConnection {
  return new BaileysConnection(opts);
}
