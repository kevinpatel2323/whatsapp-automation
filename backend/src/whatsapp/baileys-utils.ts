import type { Message } from "../db/entities/Message.js";
import type { MessagePayload } from "../realtime/socket.gateway.js";

export function jidIsGroup(jid: string): boolean {
  return jid.endsWith("@g.us");
}

export function contactDisplayName(c: {
  name?: string | null;
  notify?: string | null;
  verifiedName?: string | null;
}): string | null {
  const n = c.name?.trim() || c.notify?.trim() || c.verifiedName?.trim();
  return n || null;
}

export function previewFromMessage(me: Message): {
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

export function messageToPayload(accountId: string, m: Message): MessagePayload {
  return {
    accountId,
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
