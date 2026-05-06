import { BufferJSON, getContentType, toNumber, type WAMessage } from "baileys";
import { Message } from "../db/entities/Message.js";

type MessageKey = WAMessage["key"] & {
  remoteJidAlt?: string | null;
  participantAlt?: string | null;
};

export function wamessageToStorableJson(msg: WAMessage) {
  return JSON.parse(
    JSON.stringify(msg, BufferJSON.replacer),
  ) as Record<string, unknown>;
}

/**
 * Text/caption for known message kinds; for media without caption body is null
 * and messageType is the content type key.
 */
function extractTypeAndBody(m: WAMessage): { type: string; body: string | null } {
  if (!m.message) {
    return { type: "empty", body: null };
  }
  const t0 = getContentType(m.message);
  const t = t0 ? String(t0) : "unknown";
  const c = m.message;
  if (c.conversation) return { type: t, body: c.conversation };
  if (c.extendedTextMessage?.text) {
    return { type: t, body: c.extendedTextMessage.text };
  }
  if (c.imageMessage?.caption) {
    return { type: t, body: c.imageMessage.caption };
  }
  if (c.videoMessage?.caption) {
    return { type: t, body: c.videoMessage.caption };
  }
  if (c.documentMessage?.caption) {
    return { type: t, body: c.documentMessage.caption };
  }
  if (c.reactionMessage?.text) {
    return { type: t, body: c.reactionMessage.text };
  }
  if (c.buttonsResponseMessage?.selectedButtonId) {
    return { type: t, body: c.buttonsResponseMessage.selectedButtonId };
  }
  if (c.listResponseMessage) {
    const lr = c.listResponseMessage;
    return {
      type: t,
      body:
        lr.title ??
        lr.description ??
        lr.singleSelectReply?.selectedRowId ??
        null,
    };
  }
  return { type: t, body: null };
}

function toTimestampMsString(msg: WAMessage): string {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const n = toNumber((msg as any).messageTimestamp);
  if (!Number.isFinite(n) || n <= 0) {
    return String(Date.now());
  }
  // Usually seconds; if already ms, do not double-scale
  return String(n < 1e12 ? n * 1000 : n);
}

export function mapWAMessageToEntity(
  m: WAMessage,
  raw: Record<string, unknown>,
): { message: Message; chatJid: string } {
  const k = m.key;
  if (!k?.id || !k?.remoteJid) {
    throw new Error("Invalid WAMessage: missing key");
  }
  const { type, body } = extractTypeAndBody(m);
  const key = k as MessageKey;
  const ts = toTimestampMsString(m);

  const ent = new Message();
  ent.id = k.id;
  ent.remoteJid = k.remoteJid;
  ent.fromMe = k.fromMe === true;
  ent.participant = k.participant ?? null;
  ent.remoteJidAlt = key.remoteJidAlt ?? null;
  ent.participantAlt = key.participantAlt ?? null;
  ent.pushName = m.pushName ?? null;
  ent.messageType = type;
  ent.body = body;
  ent.messageTimestampMs = ts;
  ent.rawJson = raw;

  const chatJid = k.remoteJid;
  return { message: ent, chatJid };
}
