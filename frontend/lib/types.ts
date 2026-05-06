export type InboxTab = "all" | "autoReply";

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "close"
  | string;

export type MessageDto = {
  id: string;
  remoteJid: string;
  fromMe: boolean;
  participant: string | null;
  remoteJidAlt: string | null;
  participantAlt: string | null;
  pushName: string | null;
  messageType: string;
  body: string | null;
  messageTimestampMs: string;
  createdAt: string;
  intent?: string | null;
  matchedMatch?: string | null;
};

export type ReplyExclusionDto = {
  name: string;
  /** Phone (with country code), full JID, or LID user id. */
  value: string;
};

export type AutoReplySettingsDto = {
  enabled: boolean;
  buyEnabled: boolean;
  sellEnabled: boolean;
  /** When true, send on matched match only; buy/sell checkboxes are ignored. */
  ignoreIntent: boolean;
  matches: string[];
  /** Canonical match label → reply body. */
  matchReplies: Record<string, string>;
  replyText: string;
  cooldownMinutes: number;
  /** People to never auto-reply (name + number/JID). */
  replyExclusions: ReplyExclusionDto[];
  updatedAt: string;
};

export type AutoReplyLogEntry = {
  id: number;
  counterpartyJid: string;
  sourceMessageId: string;
  sourceRemoteJid: string;
  replyText: string;
  sentAt: string;
};

export type ChatRow = {
  jid: string;
  name: string | null;
  isGroup: boolean;
  lastMessageAt: string | null;
  unreadCount: number;
  updatedAt: string;
  lastMessageBody: string | null;
  lastMessageType: string | null;
  lastMessageFromMe: boolean | null;
  lastSenderName: string | null;
};

/** Socket events emitted by the backend (for documentation / typing handlers). */
export type SocketEventMap = {
  qr: { qr: string };
  "connection:state": { state: string };
  "message:new": MessageDto;
  "chat:updated": ChatRow;
  "auto-reply:sent": {
    counterpartyJid?: string;
    sourceMessageId?: string | null;
    /** Conversation thread (DM or group) where the trigger message was received. */
    sourceRemoteJid?: string | null;
  };
  "settings:updated": AutoReplySettingsDto;
};
