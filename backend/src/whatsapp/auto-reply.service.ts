import type { WAMessage } from "baileys";
import type { DataSource } from "typeorm";
import pino from "pino";
import { AutoReplyLog } from "../db/entities/AutoReplyLog.js";
import { AutoReplySettings } from "../db/entities/AutoReplySettings.js";
import type { Message } from "../db/entities/Message.js";
import { classifyText } from "./classifier.js";
import { isCounterpartyExcluded } from "./jid-exclusion.js";
import type { RealtimeEmits } from "../realtime/socket.gateway.js";

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

type WASocketT = {
  user?: { id: string } | null;
  sendMessage: (
    jid: string,
    content: { text: string },
    options?: { quoted?: WAMessage },
  ) => Promise<unknown>;
};

type GetSocket = () => WASocketT | null;
type GetUserJid = () => string | undefined;

export function createAutoReplyService(opts: {
  dataSource: DataSource;
  getSocket: GetSocket;
  getUserJid: GetUserJid;
  emit: RealtimeEmits;
}) {
  const { dataSource, getSocket, getUserJid, emit } = opts;

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

  /**
   * JID to DM: group → participant; 1:1 → remoteJid. Never send to @g.us or broadcast.
   */
  function resolveCounterpartyJid(m: WAMessage): string | null {
    if (m.key.fromMe) {
      return null;
    }
    const rj = m.key.remoteJid;
    if (!rj || rj === "status@broadcast") {
      return null;
    }
    if (rj.endsWith("@g.us")) {
      const p = m.key.participant ?? (m.key as { participantAlt?: string | null }).participantAlt;
      return p ?? null;
    }
    return rj;
  }

  function isSelfJid(jid: string) {
    const u = getUserJid();
    if (!u) {
      return false;
    }
    // Same node user id: compare first segment; covers PN/LID in basic setups
    const a = u.split("@")[0];
    const b = jid.split("@")[0];
    return a === b;
  }

  async function onCooldown(counterparty: string, cooldownMs: number): Promise<boolean> {
    const last = await dataSource.getRepository(AutoReplyLog).findOne({
      where: { counterpartyJid: counterparty },
      order: { sentAt: "DESC" },
    });
    if (!last?.sentAt) {
      return false;
    }
    return Date.now() - last.sentAt.getTime() < cooldownMs;
  }

  /**
   * Classify and persist on Message entity (fills intent, matchedMatch).
   */
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

  /**
   * After a message row is stored: maybe send a DM to the person.
   */
  function resolveReplyText(
    st: AutoReplySettings,
    matched: string,
  ): string {
    const map = st.matchReplies ?? {};
    const fromMap = map[matched]?.trim();
    if (fromMap) {
      return fromMap;
    }
    return (st.replyText ?? "").trim();
  }

  async function maybeAutoReply(
    wam: WAMessage,
    me: Message,
  ): Promise<void> {
    if (wam.key.fromMe) {
      return;
    }
    if (!me.matchedMatch) {
      return;
    }
    const st = await getSettings();
    if (!st.enabled) {
      return;
    }
    if (!st.matches.map((m) => m.trim()).filter(Boolean).includes(me.matchedMatch!)) {
      return;
    }
    const ignoreIntent = st.ignoreIntent ?? true;
    if (!ignoreIntent) {
      if (me.intent === "none") {
        return;
      }
      if (me.intent === "buy" && !st.buyEnabled) {
        return;
      }
      if (me.intent === "sell" && !st.sellEnabled) {
        return;
      }
    }
    const replyText = resolveReplyText(st, me.matchedMatch);
    if (!replyText) {
      return;
    }

    const target = resolveCounterpartyJid(wam);
    if (!target) {
      return;
    }
    if (target.endsWith("@g.us") || target.endsWith("@broadcast")) {
      return;
    }
    if (isSelfJid(target)) {
      return;
    }
    if (isCounterpartyExcluded(target, st.replyExclusions ?? [])) {
      return;
    }
    if (await onCooldown(target, st.cooldownMinutes * 60_000)) {
      return;
    }

    const sock = getSocket();
    if (!sock) {
      return;
    }

    const sourceJid = wam.key.remoteJid ?? "";
    const isGroupSource = sourceJid.endsWith("@g.us");

    try {
      await sock.sendMessage(
        target,
        { text: replyText },
        isGroupSource ? { quoted: wam } : undefined,
      );
      const row = new AutoReplyLog();
      row.counterpartyJid = target;
      row.sourceMessageId = wam.key.id ?? "";
      row.sourceRemoteJid = wam.key.remoteJid ?? "";
      row.replyText = replyText;
      await dataSource.getRepository(AutoReplyLog).save(row);
      emit.emitAutoReplySent({
        counterpartyJid: target,
        sourceMessageId: wam.key.id,
        sourceRemoteJid: wam.key.remoteJid,
      });
      log.info(
        {
          target,
          messageId: wam.key.id,
          match: me.matchedMatch,
          intent: me.intent,
          privateReply: isGroupSource,
        },
        "Auto-reply sent",
      );
    } catch (e) {
      log.error({ e, target }, "Auto-reply send failed");
    }
  }

  return {
    getSettings: (force = false) => getSettings(force),
    invalidateSettingsCache,
    applyClassificationToMessage,
    maybeAutoReply,
  };
}
