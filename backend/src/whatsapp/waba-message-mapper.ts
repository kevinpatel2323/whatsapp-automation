import { Message } from "../db/entities/Message.js";
import { Chat } from "../db/entities/Chat.js";

/** Minimal shape of a WABA inbound message from Meta's webhook payload */
export interface WabaInboundMessage {
  id: string;          // wamid
  from: string;        // sender phone number (digits only, no +)
  timestamp: string;   // Unix seconds as string
  type: string;        // "text" | "image" | "audio" | "video" | "document" | "button" | "interactive" | ...
  text?: { body: string };
  image?: { caption?: string; id?: string };
  video?: { caption?: string; id?: string };
  audio?: { id?: string };
  document?: { caption?: string; id?: string; filename?: string };
  button?: { text: string; payload: string };
  interactive?: {
    type: "list_reply" | "button_reply";
    list_reply?: { id: string; title: string };
    button_reply?: { id: string; title: string };
  };
  context?: { id: string; from: string };
}

export interface WabaContact {
  wa_id: string;
  profile: { name: string };
}

export interface WabaMetadata {
  display_phone_number: string;
  phone_number_id: string;
}

function extractBody(msg: WabaInboundMessage): { type: string; body: string | null } {
  switch (msg.type) {
    case "text":
      return { type: "text", body: msg.text?.body ?? null };
    case "image":
      return { type: "imageMessage", body: msg.image?.caption ?? "(image)" };
    case "video":
      return { type: "videoMessage", body: msg.video?.caption ?? "(video)" };
    case "audio":
      return { type: "audioMessage", body: null };
    case "document":
      return { type: "documentMessage", body: msg.document?.caption ?? msg.document?.filename ?? "(document)" };
    case "button":
      return { type: "buttonsResponseMessage", body: msg.button?.text ?? null };
    case "interactive": {
      const ir = msg.interactive;
      const body =
        ir?.list_reply?.title ?? ir?.button_reply?.title ?? ir?.list_reply?.id ?? ir?.button_reply?.id ?? null;
      return { type: "interactiveMessage", body };
    }
    default:
      return { type: msg.type, body: null };
  }
}

export function wabaMessageToEntity(
  accountId: string,
  msg: WabaInboundMessage,
  contacts: WabaContact[],
  phoneNumberId: string,
): Message {
  const jid = `${msg.from}@s.whatsapp.net`;
  const { type, body } = extractBody(msg);
  const tsMs = (BigInt(msg.timestamp) * 1000n).toString();
  const pushName = contacts.find((c) => c.wa_id === msg.from)?.profile.name ?? null;

  const entity = new Message();
  entity.accountId = accountId;
  entity.id = msg.id; // wamid as message ID
  entity.remoteJid = jid;
  entity.fromMe = false;
  entity.participant = null;
  entity.remoteJidAlt = null;
  entity.participantAlt = null;
  entity.pushName = pushName;
  entity.messageType = type;
  entity.body = body;
  entity.messageTimestampMs = tsMs;
  entity.rawJson = { wabaId: msg.id, type: msg.type, from: msg.from };
  entity.provider = "waba";
  return entity;
}

export function wabaMessageToChat(
  accountId: string,
  msg: WabaInboundMessage,
  contacts: WabaContact[],
  existing: Chat | null,
  { body, type }: { body: string | null; type: string },
): Chat {
  const jid = `${msg.from}@s.whatsapp.net`;
  const pushName = contacts.find((c) => c.wa_id === msg.from)?.profile.name ?? null;
  const ts = new Date(Number(msg.timestamp) * 1000);

  const chat = existing ?? new Chat();
  chat.accountId = accountId;
  chat.jid = jid;
  chat.name = pushName ?? chat.name ?? null;
  chat.isGroup = false;
  chat.lastMessageAt = ts;
  chat.unreadCount = (chat.unreadCount ?? 0) + 1;
  chat.updatedAt = new Date();
  chat.lastMessageBody = body;
  chat.lastMessageType = type;
  chat.lastMessageFromMe = false;
  chat.lastSenderName = pushName;
  return chat;
}
