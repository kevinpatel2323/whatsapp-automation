export type Account = {
  id: string;
  type: "baileys" | "waba";
  displayName: string;
  phoneE164: string | null;
  status: "idle" | "connecting" | "open" | "close";
  isActive: boolean;
};

export type MessageTemplate = {
  id: string;
  accountId: string;
  name: string;
  language: string;
  category: string;
  status: string;
  placeholders: string[];
  lastSyncedAt: string | null;
};

export type WabaDeliveryStatus = {
  accountId: string;
  providerMessageId: string;
  recipientJid: string | null;
  status: "accepted" | "sent" | "delivered" | "read" | "failed" | "deleted";
  statusAt: string;
  error?: { code: string | null; title: string | null; message: string | null } | null;
};

export type ClassifiedMessageDto = {
  accountId?: string;
  messageId: string;
  remoteJid: string;
  fromMe: boolean;
  intent: string;
  matchedMatch: string | null;
  isConfiguredMatch: boolean;
  matchDate: string | null;
  quantity: number | null;
  blocks: string[];
  seats: string[];
  sequenceRequired: boolean | null;
  sequenceNote: string | null;
  priceHints: string[];
  extraInfo: string[];
  rawSnippet: string | null;
  body: string | null;
  messageTimestampMs: string;
  senderPushName: string | null;
  senderParticipant: string | null;
  /** PN JID when `senderParticipant` is an `@lid`. */
  senderParticipantAlt: string | null;
  groupJid: string | null;
  groupName: string | null;
  createdAt: string;
};

export type ClassifiedFacetsDto = {
  matches: string[];
  blocks: { block: string; count: number }[];
  senders: { participant: string | null; pushName: string | null; count: number }[];
};

export type InboxTab = "all" | "autoReply";

/** Points at a stored WhatsApp message (e.g. in a group) to quote when sending a private DM. */
export type GroupMessageReplyRef = {
  remoteJid: string;
  messageId: string;
  fromMe: boolean;
};

export type ConnectionState =
  | "idle"
  | "connecting"
  | "open"
  | "close"
  | string;

export type MessageDto = {
  accountId?: string;
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

export type MatchRoutingMode = "baileys-text" | "waba-text" | "waba-template";

export type MatchRouting = {
  accountId: string;
  mode: MatchRoutingMode;
  templateId?: string | null;
  templateParamsTemplate?: Record<string, string> | null;
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
  /** Per-match send routing. Absent = use Baileys default. */
  replyRouting?: Record<string, MatchRouting>;
  /** Default routing for matches without a specific entry. */
  defaultRouting?: MatchRouting | null;
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
  accountId?: string;
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
  qr: { accountId?: string; qr: string };
  "connection:state": { accountId?: string; state: string };
  "account:updated": Account;
  "message:new": MessageDto;
  "message:classified": ClassifiedMessageDto;
  "chat:updated": ChatRow;
  "auto-reply:sent": {
    accountId?: string;
    counterpartyJid?: string;
    sourceMessageId?: string | null;
    /** Conversation thread (DM or group) where the trigger message was received. */
    sourceRemoteJid?: string | null;
  };
  "settings:updated": AutoReplySettingsDto;
  "waba:status": WabaDeliveryStatus;
  "send:error": { accountId?: string; jid: string; error: string; requestId?: string };
};
