import type { Server, Socket } from "socket.io";

export type MessagePayload = {
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

/** Serialized chat row for REST + `chat:updated` socket events */
export type ChatRowPayload = {
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

function createEmits(io: Server) {
  return {
    emitQR(qr: string) {
      io.emit("qr", { qr });
    },
    emitConnection(state: "connecting" | "open" | "close") {
      io.emit("connection:state", { state });
    },
    /**
     * Broadcasts to all and to `chat:${jid}` room.
     */
    emitMessage(jid: string, payload: MessagePayload) {
      io.emit("message:new", payload);
      io.to(`chat:${jid}`).emit("message:new", payload);
    },
    emitChatUpdated(chat: ChatRowPayload) {
      io.emit("chat:updated", chat);
    },
    emitSettingsUpdated(settings: Record<string, unknown>) {
      io.emit("settings:updated", settings);
    },
    emitAutoReplySent(payload: {
      counterpartyJid: string;
      sourceMessageId?: string | null;
      sourceRemoteJid?: string | null;
    }) {
      io.emit("auto-reply:sent", payload);
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
    socket.on("join:chat", (jid: string) => {
      if (typeof jid === "string" && jid) {
        void socket.join(`chat:${jid}`);
      }
    });
    socket.on("leave:chat", (jid: string) => {
      if (typeof jid === "string" && jid) {
        void socket.leave(`chat:${jid}`);
      }
    });
  });

  return emits;
}

export type RealtimeEmits = ReturnType<typeof createEmits>;
