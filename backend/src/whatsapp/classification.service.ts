import type { EntityManager } from "typeorm";
import { ClassifiedMessage } from "../db/entities/ClassifiedMessage.js";
import type { Chat } from "../db/entities/Chat.js";
import type { Message } from "../db/entities/Message.js";
import type { ClassifiedMessagePayload } from "../realtime/socket.gateway.js";
import type { createAutoReplyService } from "./auto-reply.service.js";
import { classifyTextRich } from "./classifier.js";

type AutoReplyLike = Pick<ReturnType<typeof createAutoReplyService>, "getSettings">;

function jidIsGroup(jid: string): boolean {
  return jid.endsWith("@g.us");
}

function toPayload(row: ClassifiedMessage): ClassifiedMessagePayload {
  return {
    messageId: row.messageId,
    remoteJid: row.remoteJid,
    fromMe: row.fromMe,
    intent: row.intent,
    matchedMatch: row.matchedMatch ?? null,
    isConfiguredMatch: Boolean(row.isConfiguredMatch),
    matchDate: row.matchDate ?? null,
    quantity: row.quantity ?? null,
    blocks: row.blocks ?? [],
    seats: row.seats ?? [],
    sequenceRequired: row.sequenceRequired ?? null,
    sequenceNote: row.sequenceNote ?? null,
    priceHints: row.priceHints ?? [],
    extraInfo: row.extraInfo ?? [],
    rawSnippet: row.rawSnippet ?? null,
    body: row.body ?? null,
    messageTimestampMs: row.messageTimestampMs,
    senderPushName: row.senderPushName ?? null,
    senderParticipant: row.senderParticipant ?? null,
    groupJid: row.groupJid ?? null,
    groupName: row.groupName ?? null,
    createdAt: row.createdAt.toISOString(),
  };
}

export function createClassificationService(opts: {
  autoReply: AutoReplyLike;
}) {
  const { autoReply } = opts;

  /**
   * Upsert `classified_messages` for this message row (same transaction as Message upsert).
   */
  async function upsertInTransaction(
    em: EntityManager,
    me: Message,
    chat: Chat | null,
  ): Promise<ClassifiedMessagePayload> {
    const st = await autoReply.getSettings();
    const rich = classifyTextRich(me.body, st.matches);

    const isGroup = jidIsGroup(me.remoteJid);
    const groupJid = isGroup ? me.remoteJid : null;
    const groupName = isGroup ? (chat?.name?.trim() || null) : null;

    const row: Partial<ClassifiedMessage> = {
      messageId: me.id,
      remoteJid: me.remoteJid,
      fromMe: me.fromMe,
      intent: rich.intent,
      matchedMatch: rich.matchedMatch,
      isConfiguredMatch: rich.isConfiguredMatch,
      matchDate: rich.matchDate,
      quantity: rich.quantity,
      blocks: rich.blocks,
      seats: rich.seats,
      sequenceRequired: rich.sequenceRequired,
      sequenceNote: rich.sequenceNote,
      priceHints: rich.priceHints,
      extraInfo: rich.extraInfo,
      rawSnippet: rich.rawSnippet || null,
      body: me.body != null ? String(me.body).slice(0, 4000) : null,
      messageTimestampMs: me.messageTimestampMs,
      senderPushName: me.pushName?.trim() || null,
      senderParticipant: me.participant?.trim() || null,
      groupJid,
      groupName,
    };

    await em.getRepository(ClassifiedMessage).upsert(row as ClassifiedMessage, {
      conflictPaths: ["messageId", "remoteJid", "fromMe"],
    });

    const saved = await em.getRepository(ClassifiedMessage).findOne({
      where: { messageId: me.id, remoteJid: me.remoteJid, fromMe: me.fromMe },
    });
    if (!saved) {
      throw new Error("classified_messages upsert failed");
    }
    return toPayload(saved);
  }

  return { upsertInTransaction };
}

export type ClassificationService = ReturnType<typeof createClassificationService>;
