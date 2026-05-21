/**
 * Common interface for all WhatsApp transport implementations (Baileys, WABA).
 * Phase 1: BaileysConnection implements this. Phase 2: WabaConnection added.
 */
export interface WhatsAppConnection {
  readonly accountId: string;
  readonly type: "baileys" | "waba";

  connect(): Promise<void>;
  disconnect(): Promise<void>;
  logout(): Promise<{ ok: true } | { ok: false; error: string }>;

  getStatus(): "idle" | "connecting" | "open" | "close";
  /** Baileys: socket user JID. WABA: phone number ID. */
  getUserIdentifier(): string | undefined;

  sendText(
    jid: string,
    text: string,
    opts?: {
      /** DB-keyed quoted message — only honored on Baileys path. */
      quoted?: { remoteJid: string; messageId: string; fromMe: boolean };
      /** WABA reply-context wamid; Baileys ignores this. */
      contextWamid?: string;
    },
  ): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }>;

  sendTemplate(
    jid: string,
    opts: {
      templateId: string;
      language: string;
      components: Array<{
        type: "header" | "body" | "button";
        parameters: Array<{ type: "text"; text: string }>;
      }>;
    },
  ): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }>;

  /** Whether freeform text can be sent outside the 24-hour customer service window. */
  canSendFreeformOutsideWindow(): boolean;
  /** Whether the transport supports quoting a specific prior message. */
  canQuoteMessages(): boolean;
  /** Whether this account can join / receive from WhatsApp groups. */
  canJoinGroups(): boolean;

  /**
   * Expose the underlying Baileys socket for internal usage (auto-reply quoting).
   * WABA implementation returns null.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  getRawSocket(): { sendMessage: (...args: any[]) => Promise<any>; user?: { id: string } | null } | null;
}
