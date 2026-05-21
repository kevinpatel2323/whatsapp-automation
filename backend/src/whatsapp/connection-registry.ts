import type { DataSource } from "typeorm";
import pino from "pino";
import { WhatsAppAccount } from "../db/entities/WhatsAppAccount.js";
import { BaileysConnection } from "./baileys.service.js";
import { WabaConnection } from "./waba.service.js";
import type { WhatsAppConnection } from "./connection.js";
import type { RealtimeEmits, AccountSummary } from "../realtime/socket.gateway.js";
import type { createAutoReplyService } from "./auto-reply.service.js";
import type { createClassificationService } from "./classification.service.js";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

export class ConnectionRegistry {
  private connections = new Map<string, WhatsAppConnection>();
  private dataSource: DataSource;
  private emit: RealtimeEmits;
  private autoReply: ReturnType<typeof createAutoReplyService>;
  private classification: ReturnType<typeof createClassificationService>;

  constructor(opts: {
    dataSource: DataSource;
    emit: RealtimeEmits;
    autoReply: ReturnType<typeof createAutoReplyService>;
    classification: ReturnType<typeof createClassificationService>;
  }) {
    this.dataSource = opts.dataSource;
    this.emit = opts.emit;
    this.autoReply = opts.autoReply;
    this.classification = opts.classification;
  }

  /** Load all active accounts from DB and connect them. */
  async loadActive(): Promise<void> {
    const accounts = await this.dataSource
      .getRepository(WhatsAppAccount)
      .find({ where: { isActive: true } });

    for (const account of accounts) {
      if (this.connections.has(account.id)) continue;
      let conn: WhatsAppConnection;
      try {
        conn = this.createConnection(account);
      } catch (e) {
        log.warn({ accountId: account.id, e }, "Skipping account — cannot create connection");
        continue;
      }
      this.connections.set(account.id, conn);
      void conn.connect().catch((e) => {
        log.error({ accountId: account.id, e }, "Connection failed on startup");
      });
    }
  }

  private createConnection(account: WhatsAppAccount): WhatsAppConnection {
    if (account.type === "baileys") {
      return new BaileysConnection({
        accountId: account.id,
        authDirSlug: account.authDirSlug ?? account.id,
        dataSource: this.dataSource,
        emit: this.emit,
        autoReply: this.autoReply,
        classification: this.classification,
      });
    }
    if (account.type === "waba") {
      return WabaConnection.fromAccount(account);
    }
    throw new Error(`Unsupported account type: ${account.type}`);
  }

  /** Register a new connection at runtime (e.g. after account is added via API). */
  async add(account: WhatsAppAccount): Promise<WhatsAppConnection> {
    if (this.connections.has(account.id)) return this.connections.get(account.id)!;
    const conn = this.createConnection(account);
    this.connections.set(account.id, conn);
    void conn.connect().catch((e) => {
      log.error({ accountId: account.id, e }, "Connection failed after add");
    });
    return conn;
  }

  getByAccountId(accountId: string): WhatsAppConnection | null {
    return this.connections.get(accountId) ?? null;
  }

  /** Get the primary (first active Baileys) connection. */
  getPrimary(): WhatsAppConnection | null {
    for (const conn of this.connections.values()) {
      if (conn.type === "baileys") return conn;
    }
    return this.connections.values().next().value ?? null;
  }

  list(): AccountSummary[] {
    return [...this.connections.entries()].map(([id, conn]) => ({
      id,
      type: conn.type,
      displayName: "",
      phoneE164: conn.getUserIdentifier() ?? null,
      status: conn.getStatus(),
      isActive: true,
    }));
  }

  async remove(accountId: string): Promise<void> {
    const conn = this.connections.get(accountId);
    if (conn) {
      await conn.disconnect();
      this.connections.delete(accountId);
    }
  }
}
