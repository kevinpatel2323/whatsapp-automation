import type { Server, Socket } from "socket.io";

export type MessagePayload = {
  accountId: string;
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
  intent: string | null;
  matchedMatch: string | null;
};

/** Classified row for REST + `message:classified` */
export type ClassifiedMessagePayload = {
  accountId: string;
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
  senderParticipantAlt: string | null;
  groupJid: string | null;
  groupName: string | null;
  createdAt: string;
};

/** Serialized chat row for REST + `chat:updated` socket events */
export type ChatRowPayload = {
  accountId: string;
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

export type AccountSummary = {
  id: string;
  type: "baileys" | "waba";
  displayName: string;
  phoneE164: string | null;
  status: "idle" | "connecting" | "open" | "close";
  isActive: boolean;
};

function createEmits(io: Server) {
  return {
    emitQR(accountId: string, qr: string) {
      io.emit("qr", { accountId, qr });
      io.to(`account:${accountId}`).emit("qr", { accountId, qr });
    },
    emitConnection(accountId: string, state: "connecting" | "open" | "close") {
      const payload = { accountId, state };
      io.emit("connection:state", payload);
      io.to(`account:${accountId}`).emit("connection:state", payload);
    },
    /**
     * Broadcasts to all and to `chat:${jid}` room (backward compat)
     * and the canonical `account:${accountId}:chat:${jid}` room.
     */
    emitMessage(accountId: string, jid: string, payload: MessagePayload) {
      io.emit("message:new", payload);
      io.to(`chat:${jid}`).emit("message:new", payload);
      io.to(`account:${accountId}:chat:${jid}`).emit("message:new", payload);
    },
    emitMessageClassified(accountId: string, jid: string, payload: ClassifiedMessagePayload) {
      io.emit("message:classified", payload);
      io.to(`chat:${jid}`).emit("message:classified", payload);
      io.to(`account:${accountId}:chat:${jid}`).emit("message:classified", payload);
    },
    emitChatUpdated(chat: ChatRowPayload) {
      io.emit("chat:updated", chat);
      io.to(`account:${chat.accountId}`).emit("chat:updated", chat);
    },
    emitSettingsUpdated(settings: Record<string, unknown>) {
      io.emit("settings:updated", settings);
    },
    emitAutoReplySent(payload: {
      accountId: string;
      counterpartyJid: string;
      sourceMessageId?: string | null;
      sourceRemoteJid?: string | null;
    }) {
      io.emit("auto-reply:sent", payload);
    },
    emitAccountUpdated(account: AccountSummary) {
      io.emit("account:updated", account);
      io.to(`account:${account.id}`).emit("account:updated", account);
    },
    emitWabaStatus(payload: {
      accountId: string;
      providerMessageId: string;
      recipientJid: string | null;
      status: string;
      statusAt: string;
      error?: { code: string | null; title: string | null; message: string | null } | null;
    }) {
      io.emit("waba:status", payload);
      io.to(`account:${payload.accountId}`).emit("waba:status", payload);
    },
    emitSendError(payload: {
      accountId: string;
      jid: string;
      error: string;
      requestId?: string;
    }) {
      io.emit("send:error", payload);
      io.to(`account:${payload.accountId}`).emit("send:error", payload);
    },
  };
}

export function createSocketGateway(
  io: Server,
  opts: { onSubscribe?: (socket: Socket) => void } = {},
) {
  const emits = createEmits(io);
  const onSubscribe = opts.onSubscribe;

  io.on("connection", (socket) => {
    onSubscribe?.(socket);

    socket.on("join:chat", (payload: string | { accountId?: string; jid: string }) => {
      if (typeof payload === "string" && payload) {
        void socket.join(`chat:${payload}`);
      } else if (typeof payload === "object" && payload.jid) {
        void socket.join(`chat:${payload.jid}`);
        if (payload.accountId) {
          void socket.join(`account:${payload.accountId}:chat:${payload.jid}`);
        }
      }
    });
    socket.on("leave:chat", (payload: string | { accountId?: string; jid: string }) => {
      if (typeof payload === "string" && payload) {
        void socket.leave(`chat:${payload}`);
      } else if (typeof payload === "object" && payload.jid) {
        void socket.leave(`chat:${payload.jid}`);
        if (payload.accountId) {
          void socket.leave(`account:${payload.accountId}:chat:${payload.jid}`);
        }
      }
    });
    socket.on("join:account", (accountId: string) => {
      if (typeof accountId === "string" && accountId) {
        void socket.join(`account:${accountId}`);
      }
    });
    socket.on("leave:account", (accountId: string) => {
      if (typeof accountId === "string" && accountId) {
        void socket.leave(`account:${accountId}`);
      }
    });
  });

  return emits;
}

export type RealtimeEmits = ReturnType<typeof createEmits>;
