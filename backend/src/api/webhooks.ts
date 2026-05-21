import { createHmac } from "node:crypto";
import { Router } from "express";
import type { Request, Response } from "express";
import pino from "pino";
import { safeEqual } from "../crypto.js";
import type { DataSource } from "typeorm";
import { Message } from "../db/entities/Message.js";
import { Chat } from "../db/entities/Chat.js";
import { MessageDelivery } from "../db/entities/MessageDelivery.js";
import type { RealtimeEmits } from "../realtime/socket.gateway.js";
import { chatToPayload } from "../db/chat-serialize.js";
import type { ConnectionRegistry } from "../whatsapp/connection-registry.js";
import type { createAutoReplyService } from "../whatsapp/auto-reply.service.js";
import type { ClassificationService } from "../whatsapp/classification.service.js";
import { WabaConnection } from "../whatsapp/waba.service.js";
import {
  wabaMessageToEntity,
  wabaMessageToChat,
  type WabaInboundMessage,
  type WabaContact,
} from "../whatsapp/waba-message-mapper.js";

const log = pino({ level: process.env.LOG_LEVEL ?? "info" });

interface WabaWebhookBody {
  object?: string;
  entry?: Array<{
    id: string;
    changes: Array<{
      value: {
        messaging_product: string;
        metadata: { display_phone_number: string; phone_number_id: string };
        contacts?: WabaContact[];
        messages?: WabaInboundMessage[];
        statuses?: Array<{
          id: string;
          recipient_id: string;
          status: string;
          timestamp: string;
          errors?: Array<{ code: number; title: string; message: string }>;
        }>;
      };
      field: string;
    }>;
  }>;
}

function verifySignature(rawBody: Buffer, appSecret: string, sigHeader: string | undefined): boolean {
  if (!sigHeader?.startsWith("sha256=")) return false;
  const expected = createHmac("sha256", appSecret).update(rawBody).digest();
  const provided = Buffer.from(sigHeader.slice("sha256=".length), "hex");
  if (provided.length !== expected.length) return false;
  return safeEqual(expected, provided);
}

export function mountWebhooks(opts: {
  router: Router;
  registry: ConnectionRegistry;
  dataSource: DataSource;
  emit: RealtimeEmits;
  autoReply: ReturnType<typeof createAutoReplyService>;
  classification: ClassificationService;
}): void {
  const { router, registry, dataSource, emit, autoReply, classification } = opts;

  // Meta verification challenge (GET)
  router.get("/waba/:accountId", (req: Request, res: Response) => {
    const conn = registry.getByAccountId(req.params.accountId);
    if (!conn || conn.type !== "waba") {
      res.sendStatus(404);
      return;
    }
    const waba = conn as WabaConnection;
    const mode = req.query["hub.mode"];
    const token = req.query["hub.verify_token"];
    const challenge = req.query["hub.challenge"];
    if (mode === "subscribe" && token === waba.getCredentials().webhookVerifyToken) {
      res.status(200).send(String(challenge));
    } else {
      res.sendStatus(403);
    }
  });

  // Incoming events (POST) — raw body for HMAC
  router.post("/waba/:accountId", async (req: Request, res: Response) => {
    const rawBody = req.body as Buffer;
    const accountId = req.params.accountId;
    const bodyLen = Buffer.isBuffer(rawBody) ? rawBody.length : -1;

    log.info({ accountId, bodyLen }, "WABA webhook POST received");

    const conn = registry.getByAccountId(accountId);
    if (!conn || conn.type !== "waba") {
      log.warn(
        { accountId, hasConn: !!conn, connType: conn?.type ?? null, knownIds: registry.list().map((a) => a.id) },
        "WABA webhook dropped — accountId not in registry (or not a WABA connection)",
      );
      // Always 200 per Meta docs
      res.sendStatus(200);
      return;
    }

    const waba = conn as WabaConnection;
    const sig = req.headers["x-hub-signature-256"] as string | undefined;

    if (!verifySignature(rawBody, waba.getCredentials().appSecret, sig)) {
      log.warn(
        { accountId, hasSig: !!sig, sigPrefix: sig?.slice(0, 14) ?? null, bodyLen },
        "WABA webhook signature mismatch — dropping (check app_secret stored on this account matches the Meta App Secret used to sign)",
      );
      res.sendStatus(200);
      return;
    }

    let body: WabaWebhookBody;
    try {
      body = JSON.parse(rawBody.toString("utf8")) as WabaWebhookBody;
    } catch (e) {
      log.warn({ accountId, e }, "WABA webhook dropped — body is not valid JSON");
      res.sendStatus(200);
      return;
    }

    // Respond immediately; process async
    res.sendStatus(200);

    if (body.object !== "whatsapp_business_account") {
      log.warn({ accountId, object: body.object }, "WABA webhook ignored — unexpected `object` field");
      return;
    }

    const entryCount = body.entry?.length ?? 0;
    log.info({ accountId, entryCount }, "WABA webhook signature OK — processing entries");

    for (const entry of body.entry ?? []) {
      for (const change of entry.changes ?? []) {
        if (change.field !== "messages") {
          log.info({ accountId, field: change.field }, "WABA webhook skipping change — not a `messages` field");
          continue;
        }
        const value = change.value;

        // Cross-check phoneNumberId matches this account
        if (value.metadata.phone_number_id !== waba.getCredentials().phoneNumberId) {
          log.warn(
            {
              accountId,
              metaPhoneNumberId: value.metadata.phone_number_id,
              expectedPhoneNumberId: waba.getCredentials().phoneNumberId,
            },
            "WABA webhook dropped — phone_number_id mismatch (the account row's phone_number_id doesn't match the payload)",
          );
          continue;
        }

        const contacts = value.contacts ?? [];

        const msgCount = value.messages?.length ?? 0;
        const statusCount = value.statuses?.length ?? 0;
        log.info({ accountId, msgCount, statusCount }, "WABA webhook change accepted");

        // Process inbound messages
        for (const msg of value.messages ?? []) {
          log.info(
            { accountId, msgId: msg.id, from: msg.from, type: msg.type },
            "WABA inbound message — handing to processor",
          );
          void processInboundMessage({ accountId, msg, contacts, dataSource, emit, autoReply, classification, conn }).catch(
            (e) => log.error({ accountId, msgId: msg.id, e }, "Error processing WABA inbound message"),
          );
        }

        // Process delivery statuses
        for (const status of value.statuses ?? []) {
          void processStatus({ accountId, status, dataSource, emit }).catch(
            (e) => log.error({ accountId, statusId: status.id, e }, "Error processing WABA status"),
          );
        }
      }
    }
  });
}

async function processInboundMessage(opts: {
  accountId: string;
  msg: WabaInboundMessage;
  contacts: WabaContact[];
  dataSource: DataSource;
  emit: RealtimeEmits;
  autoReply: ReturnType<typeof createAutoReplyService>;
  classification: ClassificationService;
  conn: ReturnType<ConnectionRegistry["getByAccountId"]>;
}): Promise<void> {
  const { accountId, msg, contacts, dataSource, emit, autoReply, classification, conn } = opts;

  const entity = wabaMessageToEntity(accountId, msg, contacts, "");
  const jid = entity.remoteJid;

  await dataSource.transaction(async (manager) => {
    // Upsert message (idempotent via PK)
    await manager.getRepository(Message).upsert(
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      { ...entity } as any,
      { conflictPaths: ["accountId", "id", "remoteJid", "fromMe"], skipUpdateIfNoValuesChanged: true },
    );

    // Upsert chat
    const existing = await manager.findOne(Chat, { where: { accountId, jid } });
    const { type, body: msgBody } = { type: entity.messageType, body: entity.body ?? null };
    const chat = wabaMessageToChat(accountId, msg, contacts, existing, { body: msgBody, type });
    await manager.save(Chat, chat);

    const chatPayload = chatToPayload(chat);
    emit.emitChatUpdated(chatPayload);
  });

  log.info({ accountId, jid, msgId: entity.id }, "WABA inbound persisted + chat:updated emitted");

  // Emit message event
  emit.emitMessage(accountId, jid, {
    accountId,
    id: entity.id,
    remoteJid: entity.remoteJid,
    fromMe: false,
    participant: null,
    remoteJidAlt: null,
    participantAlt: null,
    pushName: entity.pushName ?? null,
    messageType: entity.messageType,
    body: entity.body ?? null,
    messageTimestampMs: entity.messageTimestampMs,
    createdAt: new Date().toISOString(),
    intent: null,
    matchedMatch: null,
  });

  // Classify + auto-reply
  if (conn) {
    const saved = await dataSource.getRepository(Message).findOne({
      where: { accountId, id: entity.id, remoteJid: entity.remoteJid, fromMe: false },
    });
    if (saved) {
      await dataSource.transaction(async (em) => {
        await classification.upsertInTransaction(em, saved, null);
      });
      // Re-fetch to get classification results
      const classified = await dataSource.getRepository(Message).findOne({
        where: { accountId, id: entity.id, remoteJid: entity.remoteJid, fromMe: false },
      });
      if (classified) {
        await autoReply.maybeAutoReplyFromMessage(classified, conn);
      }
    }
  }
}

async function processStatus(opts: {
  accountId: string;
  status: { id: string; recipient_id: string; status: string; timestamp: string; errors?: Array<{ code: number; title: string; message: string }> };
  dataSource: DataSource;
  emit: RealtimeEmits;
}): Promise<void> {
  const { accountId, status, dataSource, emit } = opts;

  const recipientJid = `${status.recipient_id}@s.whatsapp.net`;
  const err = status.errors?.[0] ?? null;

  await dataSource
    .createQueryBuilder()
    .insert()
    .into(MessageDelivery)
    .values({
      accountId,
      providerMessageId: status.id,
      recipientJid,
      status: status.status as MessageDelivery["status"],
      statusAt: new Date(Number(status.timestamp) * 1000),
      errorCode: err ? String(err.code) : null,
      errorTitle: err?.title ?? null,
      errorMessage: err?.message ?? null,
      updatedAt: new Date(),
    })
    .orUpdate(["status", "status_at", "error_code", "error_title", "error_message", "updated_at"], [
      "account_id",
      "provider_message_id",
    ])
    .execute();

  emit.emitWabaStatus({
    accountId,
    providerMessageId: status.id,
    recipientJid,
    status: status.status,
    statusAt: new Date(Number(status.timestamp) * 1000).toISOString(),
    error: err ? { code: String(err.code), title: err.title, message: err.message } : null,
  });
}
