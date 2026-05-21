import type { WAMessage } from "baileys";
import type { DataSource } from "typeorm";
import pino from "pino";
import { AutoReplyLog } from "../db/entities/AutoReplyLog.js";
import { AutoReplySettings } from "../db/entities/AutoReplySettings.js";
import { MessageTemplate } from "../db/entities/MessageTemplate.js";
import type { Message } from "../db/entities/Message.js";
import { classifyText } from "./classifier.js";
import { isCounterpartyExcluded } from "./jid-exclusion.js";
import type { RealtimeEmits } from "../realtime/socket.gateway.js";
import type { WhatsAppConnection } from "./connection.js";

const log = pino({
  level: process.env.LOG_LEVEL ?? "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

const CACHE_TTL_MS = 5_000;
let settingsCache: AutoReplySettings | null = null;
let settingsCacheAt = 0;

export function createAutoReplyService(opts: {
  dataSource: DataSource;
  emit: RealtimeEmits;
  /** Late-bound so the registry can be wired in after service construction. */
  getConnection?: (accountId: string) => WhatsAppConnection | null;
}) {
  const { dataSource, emit } = opts;
  // mutable binding so index.ts can set it after registry is created
  let getConnectionFn: ((accountId: string) => WhatsAppConnection | null) | null =
    opts.getConnection ?? null;

  async function getSettings(force = false): Promise<AutoReplySettings> {
    if (!force && settingsCache && Date.now() - settingsCacheAt < CACHE_TTL_MS) {
      return settingsCache;
    }
    const s = await dataSource.getRepository(AutoReplySettings).findOne({
      where: { id: 1 },
    });
    if (!s) {
      throw new Error("auto_reply_settings row 1 is missing; run seed");
    }
    settingsCache = s;
    settingsCacheAt = Date.now();
    return s;
  }

  function invalidateSettingsCache() {
    settingsCache = null;
  }

  function resolveCounterpartyJid(m: WAMessage): string | null {
    if (m.key.fromMe) return null;
    const rj = m.key.remoteJid;
    if (!rj || rj === "status@broadcast") return null;
    if (rj.endsWith("@g.us")) {
      const p = m.key.participant ?? (m.key as { participantAlt?: string | null }).participantAlt;
      return p ?? null;
    }
    return rj;
  }

  function isSelfJid(jid: string, connection: WhatsAppConnection) {
    const u = connection.getUserIdentifier();
    if (!u) return false;
    const a = u.split("@")[0];
    const b = jid.split("@")[0];
    return a === b;
  }

  async function onCooldown(accountId: string, counterparty: string, cooldownMs: number): Promise<boolean> {
    const last = await dataSource.getRepository(AutoReplyLog).findOne({
      where: { accountId, counterpartyJid: counterparty },
      order: { sentAt: "DESC" },
    });
    if (!last?.sentAt) return false;
    return Date.now() - last.sentAt.getTime() < cooldownMs;
  }

  async function applyClassificationToMessage(me: Message) {
    try {
      const s = await getSettings();
      const { intent, matchedMatch } = classifyText(me.body, s.matches);
      me.intent = intent;
      me.matchedMatch = matchedMatch;
    } catch (e) {
      log.error({ e }, "classifyText failed; storing message without intent");
      me.intent = "none";
      me.matchedMatch = null;
    }
  }

  function resolveReplyText(st: AutoReplySettings, matched: string): string {
    const map = st.matchReplies ?? {};
    const fromMap = map[matched]?.trim();
    if (fromMap) return fromMap;
    return (st.replyText ?? "").trim();
  }

  async function maybeAutoReply(
    wam: WAMessage,
    me: Message,
    connection: WhatsAppConnection,
  ): Promise<void> {
    if (wam.key.fromMe) return;
    if (!me.matchedMatch) return;

    const st = await getSettings();
    if (!st.enabled) return;
    if (!st.matches.map((m) => m.trim()).filter(Boolean).includes(me.matchedMatch!)) return;

    const ignoreIntent = st.ignoreIntent ?? true;
    if (!ignoreIntent) {
      if (me.intent === "none") return;
      if (me.intent === "buy" && !st.buyEnabled) return;
      if (me.intent === "sell" && !st.sellEnabled) return;
    }

    const target = resolveCounterpartyJid(wam);
    if (!target) return;
    if (target.endsWith("@g.us") || target.endsWith("@broadcast")) return;
    if (isSelfJid(target, connection)) return;
    if (isCounterpartyExcluded(target, st.replyExclusions ?? [])) return;
    if (await onCooldown(me.accountId, target, st.cooldownMinutes * 60_000)) return;

    const routing = resolveRouting(st, me.matchedMatch);
    const sendingConn = routing
      ? (getConnectionFn?.(routing.accountId) ?? connection)
      : connection;

    const replyText = resolveReplyText(st, me.matchedMatch);
    const sourceJid = wam.key.remoteJid ?? "";
    const isGroupSource = sourceJid.endsWith("@g.us");

    try {
      if (routing?.mode === "waba-template" && routing.templateId) {
        await sendViaTemplate(sendingConn, target, routing, me, wam.key.id ?? "");
      } else if (routing?.mode === "waba-text") {
        if (!replyText) return;
        const out = await sendingConn.sendText(target, replyText);
        if (!out.ok) { log.error({ error: out.error, target }, "WABA auto-reply sendText failed"); return; }
        await recordAutoReply(me.accountId, target, wam.key.id ?? "", wam.key.remoteJid ?? "", replyText);
        log.info({ target, match: me.matchedMatch, mode: "waba-text" }, "Auto-reply sent");
      } else {
        // Default: baileys-text — use raw socket for quoted reply
        if (!replyText) return;
        const sock = sendingConn.getRawSocket();
        if (!sock) return;
        await sock.sendMessage(
          target,
          { text: replyText },
          isGroupSource ? { quoted: wam } : undefined,
        );
        await recordAutoReply(me.accountId, target, wam.key.id ?? "", wam.key.remoteJid ?? "", replyText);
        log.info({ target, match: me.matchedMatch, intent: me.intent, privateReply: isGroupSource }, "Auto-reply sent");
      }
    } catch (e) {
      log.error({ e, target }, "Auto-reply send failed");
    }
  }

  function resolveRouting(
    st: AutoReplySettings,
    matchedMatch: string,
  ): import("../db/entities/AutoReplySettings.js").MatchRouting | null {
    const specific = st.replyRouting?.[matchedMatch];
    if (specific) return specific;
    return st.defaultRouting ?? null;
  }

  async function recordAutoReply(
    accountId: string,
    target: string,
    sourceMessageId: string,
    sourceRemoteJid: string,
    replyText: string,
  ) {
    const row = new AutoReplyLog();
    row.accountId = accountId;
    row.counterpartyJid = target;
    row.sourceMessageId = sourceMessageId;
    row.sourceRemoteJid = sourceRemoteJid;
    row.replyText = replyText;
    await dataSource.getRepository(AutoReplyLog).save(row);
    emit.emitAutoReplySent({
      accountId,
      counterpartyJid: target,
      sourceMessageId,
      sourceRemoteJid,
    });
  }

  function substituteTemplateParams(
    template: Record<string, string>,
    vars: { senderName?: string | null; match?: string | null; senderPhone?: string | null },
  ): Record<string, string> {
    const out: Record<string, string> = {};
    for (const [k, v] of Object.entries(template)) {
      out[k] = v
        .replace(/\{\{senderName\}\}/g, vars.senderName ?? "")
        .replace(/\{\{match\}\}/g, vars.match ?? "")
        .replace(/\{\{senderPhone\}\}/g, vars.senderPhone ?? "");
    }
    return out;
  }

  async function sendViaTemplate(
    conn: WhatsAppConnection,
    target: string,
    routing: import("../db/entities/AutoReplySettings.js").MatchRouting,
    me: Message,
    sourceMessageId: string,
  ): Promise<void> {
    if (!routing.templateId) return;
    const phone = target.replace(/@.*$/, "");
    const vars = {
      senderName: me.pushName ?? null,
      match: me.matchedMatch ?? null,
      senderPhone: phone,
    };
    const rawParams = routing.templateParamsTemplate ?? {};
    const params = substituteTemplateParams(rawParams, vars);
    const placeholders = Object.keys(params).sort((a, b) => Number(a) - Number(b));
    const components = placeholders.length > 0
      ? [{ type: "body" as const, parameters: placeholders.map((k) => ({ type: "text" as const, text: params[k] ?? "" })) }]
      : [];
    const tmpl = await dataSource.getRepository(MessageTemplate).findOne({
      where: { accountId: conn.accountId, name: routing.templateId },
    });
    if (!tmpl) {
      log.error({ target, templateId: routing.templateId }, "WABA template auto-reply: template not found");
      return;
    }
    const out = await conn.sendTemplate(target, { templateId: routing.templateId, language: tmpl.language, components });
    if (!out.ok) {
      log.error({ target, error: out.error }, "WABA template auto-reply failed");
      return;
    }
    await recordAutoReply(me.accountId, target, sourceMessageId, me.remoteJid, `[template:${routing.templateId}]`);
    log.info({ target, match: me.matchedMatch, template: routing.templateId }, "WABA template auto-reply sent");
  }

  /** Entity-based auto-reply path (used by WABA webhook; no raw WAMessage needed). */
  async function maybeAutoReplyFromMessage(
    me: Message,
    connection: WhatsAppConnection,
  ): Promise<void> {
    if (me.fromMe) return;
    if (!me.matchedMatch) return;

    const st = await getSettings();
    if (!st.enabled) return;
    if (!st.matches.map((m) => m.trim()).filter(Boolean).includes(me.matchedMatch!)) return;

    const ignoreIntent = st.ignoreIntent ?? true;
    if (!ignoreIntent) {
      if (me.intent === "none") return;
      if (me.intent === "buy" && !st.buyEnabled) return;
      if (me.intent === "sell" && !st.sellEnabled) return;
    }

    // Derive target JID from Message entity (same logic as resolveCounterpartyJid)
    const isGroup = me.remoteJid.endsWith("@g.us");
    const target = isGroup ? (me.participant ?? null) : me.remoteJid;
    if (!target) return;
    if (target.endsWith("@g.us") || target.endsWith("@broadcast")) return;
    if (isSelfJid(target, connection)) return;
    if (isCounterpartyExcluded(target, st.replyExclusions ?? [])) return;
    if (await onCooldown(me.accountId, target, st.cooldownMinutes * 60_000)) return;

    const routing = resolveRouting(st, me.matchedMatch);
    const sendingConn = routing ? (getConnectionFn?.(routing.accountId) ?? connection) : connection;

    try {
      if (routing?.mode === "waba-template" && routing.templateId) {
        await sendViaTemplate(sendingConn, target, routing, me, me.id);
      } else {
        const replyText = resolveReplyText(st, me.matchedMatch);
        if (!replyText) return;
        const result = await sendingConn.sendText(target, replyText);
        if (!result.ok) {
          log.error({ target, error: result.error }, "Auto-reply sendText failed");
          return;
        }
        await recordAutoReply(me.accountId, target, me.id, me.remoteJid, replyText);
        log.info({ target, messageId: me.id, match: me.matchedMatch, intent: me.intent }, "Auto-reply sent (entity path)");
      }
    } catch (e) {
      log.error({ e, target }, "Auto-reply send failed (entity path)");
    }
  }

  return {
    getSettings: (force = false) => getSettings(force),
    invalidateSettingsCache,
    applyClassificationToMessage,
    maybeAutoReply,
    maybeAutoReplyFromMessage,
    setGetConnection(fn: (accountId: string) => WhatsAppConnection | null) {
      getConnectionFn = fn;
    },
  };
}
