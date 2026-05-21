import type { Chat } from "./entities/Chat.js";
import type { ChatRowPayload } from "../realtime/socket.gateway.js";

export function chatToPayload(c: Chat): ChatRowPayload {
  return {
    accountId: c.accountId,
    jid: c.jid,
    name: c.name ?? null,
    isGroup: Boolean(c.isGroup),
    lastMessageAt: c.lastMessageAt ? c.lastMessageAt.toISOString() : null,
    unreadCount: c.unreadCount ?? 0,
    updatedAt: c.updatedAt.toISOString(),
    lastMessageBody: c.lastMessageBody ?? null,
    lastMessageType: c.lastMessageType ?? null,
    lastMessageFromMe: c.lastMessageFromMe ?? null,
    lastSenderName: c.lastSenderName ?? null,
  };
}
