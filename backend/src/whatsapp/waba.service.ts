import pino from "pino";
import { decrypt } from "../crypto.js";
import type { WhatsAppAccount } from "../db/entities/WhatsAppAccount.js";
import type { WhatsAppConnection } from "./connection.js";

const log = pino({ level: "info" });

export interface WabaCredentials {
  accessToken: string;
  phoneNumberId: string;
  businessAccountId: string;
  graphApiVersion: string;
  appSecret: string;
  webhookVerifyToken: string;
}

type Status = "idle" | "connecting" | "open" | "close";

export class WabaConnection implements WhatsAppConnection {
  readonly accountId: string;
  readonly type = "waba" as const;

  private creds: WabaCredentials;
  private status: Status = "idle";
  private phoneIdentifier: string | undefined;

  constructor(accountId: string, creds: WabaCredentials) {
    this.accountId = accountId;
    this.creds = creds;
    this.phoneIdentifier = creds.phoneNumberId;
  }

  static fromAccount(account: WhatsAppAccount): WabaConnection {
    if (account.type !== "waba") throw new Error("Not a WABA account");
    if (!account.phoneNumberId) throw new Error("phoneNumberId missing");
    if (!account.businessAccountId) throw new Error("businessAccountId missing");

    const decryptField = (enc?: Buffer | null, iv?: Buffer | null, tag?: Buffer | null): string => {
      if (!enc || !iv || !tag) throw new Error(`Encrypted field missing for account ${account.id}`);
      return decrypt(enc, iv, tag);
    };

    const creds: WabaCredentials = {
      accessToken: decryptField(account.accessTokenEnc, account.accessTokenIv, account.accessTokenTag),
      phoneNumberId: account.phoneNumberId,
      businessAccountId: account.businessAccountId,
      graphApiVersion: account.graphApiVersion ?? "v22.0",
      appSecret: decryptField(account.appSecretEnc, account.appSecretIv, account.appSecretTag),
      webhookVerifyToken: decryptField(account.webhookVerifyTokenEnc, account.webhookVerifyTokenIv, account.webhookVerifyTokenTag),
    };

    return new WabaConnection(account.id, creds);
  }

  getCredentials(): WabaCredentials {
    return this.creds;
  }

  async connect(): Promise<void> {
    this.status = "connecting";
    try {
      const url = `https://graph.facebook.com/${this.creds.graphApiVersion}/${this.creds.phoneNumberId}`;
      const res = await fetch(url, {
        headers: { Authorization: `Bearer ${this.creds.accessToken}` },
      });
      if (!res.ok) {
        const body = await res.text();
        log.error({ accountId: this.accountId, status: res.status, body }, "WABA credential check failed");
        this.status = "close";
        return;
      }
      const data = (await res.json()) as { display_phone_number?: string };
      if (data.display_phone_number) this.phoneIdentifier = data.display_phone_number;
      this.status = "open";
      log.info({ accountId: this.accountId, phone: this.phoneIdentifier }, "WABA connection open");
    } catch (err) {
      log.error({ accountId: this.accountId, err }, "WABA connect error");
      this.status = "close";
    }
  }

  async disconnect(): Promise<void> {
    this.status = "idle";
  }

  async logout(): Promise<{ ok: true } | { ok: false; error: string }> {
    this.status = "idle";
    return { ok: true };
  }

  getStatus(): Status {
    return this.status;
  }

  getUserIdentifier(): string | undefined {
    return this.phoneIdentifier;
  }

  async sendText(
    jid: string,
    text: string,
    opts?: { quoted?: { remoteJid: string; messageId: string; fromMe: boolean }; contextWamid?: string },
  ): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }> {
    // Extract E.164 phone number from JID (strip @s.whatsapp.net / @lid)
    const phone = jid.replace(/@.*$/, "");
    if (!phone.match(/^\d+$/)) {
      return { ok: false, error: `Cannot derive E.164 from JID: ${jid}` };
    }

    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "text",
      text: { body: text, preview_url: false },
    };

    if (opts?.contextWamid) {
      body["context"] = { message_id: opts.contextWamid };
    }

    return this._post(body);
  }

  async sendTemplate(
    jid: string,
    opts: {
      templateId: string;
      language: string;
      components: Array<{
        type: "header" | "body" | "button";
        parameters: Array<{ type: "text"; text: string }>;
      }>;
    },
  ): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }> {
    const phone = jid.replace(/@.*$/, "");
    if (!phone.match(/^\d+$/)) {
      return { ok: false, error: `Cannot derive E.164 from JID: ${jid}` };
    }

    const body: Record<string, unknown> = {
      messaging_product: "whatsapp",
      recipient_type: "individual",
      to: phone,
      type: "template",
      template: {
        name: opts.templateId,
        language: { code: opts.language },
        components: opts.components,
      },
    };

    return this._post(body);
  }

  private async _post(
    body: Record<string, unknown>,
  ): Promise<{ ok: true; providerMessageId?: string } | { ok: false; error: string }> {
    const url = `https://graph.facebook.com/${this.creds.graphApiVersion}/${this.creds.phoneNumberId}/messages`;
    try {
      const res = await fetch(url, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.creds.accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
      });
      const data = (await res.json()) as {
        messages?: Array<{ id: string }>;
        error?: { message: string };
      };
      if (!res.ok) {
        return { ok: false, error: data.error?.message ?? `HTTP ${res.status}` };
      }
      return { ok: true, providerMessageId: data.messages?.[0]?.id };
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      return { ok: false, error: msg };
    }
  }

  canSendFreeformOutsideWindow(): boolean {
    return false;
  }

  canQuoteMessages(): boolean {
    return false;
  }

  canJoinGroups(): boolean {
    return false;
  }

  // WABA has no persistent socket; returns null.
  getRawSocket(): null {
    return null;
  }
}
