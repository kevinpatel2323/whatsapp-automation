import type { Express, Request, Response } from "express";
import { Router } from "express";
import type { DataSource } from "typeorm";
import { Message } from "../db/entities/Message.js";
import { Chat } from "../db/entities/Chat.js";
import { AutoReplyLog } from "../db/entities/AutoReplyLog.js";
import { AutoReplySettings } from "../db/entities/AutoReplySettings.js";
import { ClassifiedMessage } from "../db/entities/ClassifiedMessage.js";
import type { createAutoReplyService } from "../whatsapp/auto-reply.service.js";
import type { createBaileysService } from "../whatsapp/baileys.service.js";
import type { RealtimeEmits } from "../realtime/socket.gateway.js";
import { chatToPayload } from "../db/chat-serialize.js";

type Wa = ReturnType<typeof createBaileysService>;
type Ar = ReturnType<typeof createAutoReplyService>;

export function createAppRouter(ctx: {
  wa: Wa;
  dataSource: DataSource;
  autoReply: Ar;
  emit: RealtimeEmits;
}) {
  const { wa, dataSource, autoReply, emit } = ctx;
  const r = Router();

  r.get("/session/status", (_q: Request, res: Response) => {
    res.json({ status: wa.getStatus() });
  });

  r.post("/session/start", async (_q: Request, res: Response) => {
    const out = await wa.start();
    res.json(out);
  });

  r.post("/session/logout", async (_q: Request, res: Response) => {
    const out = await wa.logout();
    res.json(out);
  });

  r.get("/chats", async (_q: Request, res: Response) => {
    const rows = await dataSource.getRepository(Chat).find({
      order: { lastMessageAt: "DESC" },
    });
    res.json({ chats: rows.map(chatToPayload) });
  });

  /**
   * Personal chat JIDs where an auto-reply was actually sent (`counterparty_jid`).
   * Group triggers still DM the participant; we list that DM thread, not the `@g.us` source.
   */
  r.get("/chats/auto-reply-threads", async (_q: Request, res: Response) => {
    const rows = await dataSource
      .getRepository(AutoReplyLog)
      .createQueryBuilder("l")
      .select("DISTINCT l.counterpartyJid", "jid")
      .where("l.counterpartyJid != :empty", { empty: "" })
      .andWhere("l.counterpartyJid NOT LIKE :gus", { gus: "%@g.us" })
      .getRawMany<{ jid: string }>();
    const jids = rows.map((r) => r.jid).filter((j): j is string => Boolean(j?.trim()));
    res.json({ jids });
  });

  r.post("/chats/:jid/read", async (req: Request, res: Response) => {
    const jid = req.params.jid;
    if (!jid) {
      res.status(400).json({ error: "jid required" });
      return;
    }
    const repo = dataSource.getRepository(Chat);
    const row = await repo.findOne({ where: { jid } });
    if (!row) {
      res.status(404).json({ error: "Chat not found" });
      return;
    }
    row.unreadCount = 0;
    await repo.save(row);
    emit.emitChatUpdated(chatToPayload(row));
    res.json({ ok: true });
  });

  r.get("/settings", async (_q: Request, res: Response) => {
    const s = await autoReply.getSettings(true);
    res.json(serializeSettings(s));
  });

  r.patch("/settings", async (req: Request, res: Response) => {
    const repo = dataSource.getRepository(AutoReplySettings);
    const s = await repo.findOneBy({ id: 1 });
    if (!s) {
      res.status(500).json({ error: "Settings row missing" });
      return;
    }
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (typeof b.enabled === "boolean") {
      s.enabled = b.enabled;
    }
    if (typeof b.buyEnabled === "boolean") {
      s.buyEnabled = b.buyEnabled;
    }
    if (typeof b.sellEnabled === "boolean") {
      s.sellEnabled = b.sellEnabled;
    }
    if (typeof b.ignoreIntent === "boolean") {
      s.ignoreIntent = b.ignoreIntent;
    }
    if (b.matchReplies != null && typeof b.matchReplies === "object" && !Array.isArray(b.matchReplies)) {
      const raw = b.matchReplies as Record<string, unknown>;
      const out: Record<string, string> = {};
      for (const [k, v] of Object.entries(raw)) {
        if (typeof v === "string") {
          out[k.trim() || k] = v;
        } else {
          res.status(400).json({ error: `matchReplies["${k}"] must be a string` });
          return;
        }
      }
      s.matchReplies = out;
    }
    if (Array.isArray(b.matches) && b.matches.every((x) => typeof x === "string")) {
      s.matches = b.matches;
    }
    if (typeof b.replyText === "string") {
      s.replyText = b.replyText;
    }
    if (typeof b.cooldownMinutes === "number" && b.cooldownMinutes >= 1) {
      s.cooldownMinutes = Math.min(1_000, Math.floor(b.cooldownMinutes));
    }
    if (b.replyExclusions != null) {
      if (!Array.isArray(b.replyExclusions)) {
        res.status(400).json({ error: "replyExclusions must be an array" });
        return;
      }
      const out: { name: string; value: string }[] = [];
      for (const item of b.replyExclusions) {
        if (typeof item !== "object" || item === null) {
          res.status(400).json({ error: "each replyExclusion must be an object" });
          return;
        }
        const r = item as Record<string, unknown>;
        if (typeof r.name !== "string" || typeof r.value !== "string") {
          res.status(400).json({ error: "replyExclusion entries need string name and value" });
          return;
        }
        out.push({ name: r.name.trim(), value: r.value.trim() });
      }
      s.replyExclusions = out.filter((x) => x.value.length > 0);
    }
    syncMatchLabelsWithReplies(s);
    await repo.save(s);
    autoReply.invalidateSettingsCache();
    const fresh = await autoReply.getSettings(true);
    emit.emitSettingsUpdated(serializeSettings(fresh) as unknown as Record<string, unknown>);
    res.json(serializeSettings(fresh));
  });

  /** Distinct personal recipients (`counterparty_jid`) with ≥1 log row in `[fromMs, toMs)` (client local day). */
  r.get("/auto-replies/stats", async (req: Request, res: Response) => {
    const fromMs = Number.parseInt(String(req.query.fromMs ?? ""), 10);
    const toMs = Number.parseInt(String(req.query.toMs ?? ""), 10);
    const maxRange = 48 * 60 * 60 * 1000;
    if (
      !Number.isFinite(fromMs) ||
      !Number.isFinite(toMs) ||
      toMs <= fromMs ||
      toMs - fromMs > maxRange
    ) {
      res.status(400).json({ error: "valid fromMs and toMs required (toMs > fromMs, range ≤ 48h)" });
      return;
    }
    const from = new Date(fromMs);
    const to = new Date(toMs);
    const rows = await dataSource.query<Array<{ c: string | number }>>(
      `SELECT COUNT(DISTINCT counterparty_jid)::text AS c
       FROM auto_reply_log
       WHERE sent_at >= $1 AND sent_at < $2
         AND counterparty_jid <> ''
         AND counterparty_jid NOT LIKE $3`,
      [from, to, "%@g.us"],
    );
    const uniqueRecipientsToday =
      Number.parseInt(String(rows[0]?.c ?? "0"), 10) || 0;
    res.json({ uniqueRecipientsToday });
  });

  r.get("/auto-replies", async (req: Request, res: Response) => {
    const limit = Math.min(
      Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50),
      200,
    );
    const rows = await dataSource.getRepository(AutoReplyLog).find({
      order: { sentAt: "DESC" },
      take: limit,
    });
    res.json({ log: rows });
  });

  r.get("/messages", async (req: Request, res: Response) => {
    const limit = Math.min(
      Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50),
      200,
    );
    const remoteJid = req.query.remoteJid
      ? String(req.query.remoteJid)
      : undefined;
    const beforeMs = req.query.before
      ? String(req.query.before)
      : undefined;

    const qb = dataSource
      .getRepository(Message)
      .createQueryBuilder("m")
      .orderBy("m.messageTimestampMs", "DESC")
      .addOrderBy("m.id", "ASC")
      .take(limit);

    if (remoteJid) {
      qb.andWhere("m.remoteJid = :rj", { rj: remoteJid });
    }
    if (beforeMs) {
      qb.andWhere("m.messageTimestampMs < :b", { b: beforeMs });
    }

    const messages = await qb.getMany();
    res.json({ messages: messages.map(serializeMessage) });
  });

  r.get("/classified-messages/facets", async (_q: Request, res: Response) => {
    const repo = dataSource.getRepository(ClassifiedMessage);

    const matchesRaw = await repo
      .createQueryBuilder("c")
      .select("DISTINCT c.matchedMatch", "m")
      .where("c.matchedMatch IS NOT NULL")
      .orderBy("m", "ASC")
      .limit(80)
      .getRawMany<{ m: string }>();
    const matches = matchesRaw.map((r) => r.m).filter((m): m is string => Boolean(m?.trim()));

    const recent = await repo.find({
      order: { messageTimestampMs: "DESC" },
      take: 800,
    });
    const blockCounts = new Map<string, number>();
    for (const row of recent) {
      for (const b of row.blocks ?? []) {
        const k = String(b).trim();
        if (!k) continue;
        blockCounts.set(k, (blockCounts.get(k) ?? 0) + 1);
      }
    }
    const blocks = [...blockCounts.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 40)
      .map(([block, count]) => ({ block, count }));

    const senderCounts = new Map<string, { participant: string | null; pushName: string | null; count: number }>();
    for (const row of recent) {
      if (row.fromMe) continue;
      const p = row.senderParticipant ?? null;
      const n = row.senderPushName ?? null;
      if (!p && !n) continue;
      const key = `${p ?? ""}|${n ?? ""}`;
      const prev = senderCounts.get(key);
      if (prev) prev.count += 1;
      else senderCounts.set(key, { participant: p, pushName: n, count: 1 });
    }
    const senders = [...senderCounts.values()]
      .sort((a, b) => b.count - a.count)
      .slice(0, 50);

    res.json({ matches, blocks, senders });
  });

  r.get("/classified-messages", async (req: Request, res: Response) => {
    const limit = Math.min(
      Math.max(1, Number.parseInt(String(req.query.limit ?? "80"), 10) || 80),
      200,
    );
    const match = req.query.match ? String(req.query.match).trim() : undefined;
    const intent = req.query.intent ? String(req.query.intent).trim().toLowerCase() : undefined;
    const block = req.query.block ? String(req.query.block).trim() : undefined;
    const senderJid = req.query.senderJid ? String(req.query.senderJid).trim() : undefined;
    const groupJid = req.query.groupJid ? String(req.query.groupJid).trim() : undefined;
    const fromMs = req.query.fromMs != null ? String(req.query.fromMs) : undefined;
    const toMs = req.query.toMs != null ? String(req.query.toMs) : undefined;
    const beforeMs = req.query.beforeMs != null ? String(req.query.beforeMs) : undefined;
    const beforeId = req.query.beforeId != null ? String(req.query.beforeId) : undefined;
    const onlyIncoming =
      String(req.query.onlyIncoming ?? "true").toLowerCase() !== "false";
    const configuredOnly =
      String(req.query.configuredOnly ?? "").toLowerCase() === "true";

    if (intent && intent !== "buy" && intent !== "sell" && intent !== "none") {
      res.status(400).json({ error: "intent must be buy, sell, or none" });
      return;
    }

    const qb = dataSource
      .getRepository(ClassifiedMessage)
      .createQueryBuilder("c")
      .orderBy("c.messageTimestampMs", "DESC")
      .addOrderBy("c.messageId", "ASC")
      .take(limit);

    if (onlyIncoming) {
      qb.andWhere("c.fromMe = :fm", { fm: false });
    }
    if (configuredOnly) {
      qb.andWhere("c.isConfiguredMatch = :icm", { icm: true });
    }
    if (match) {
      qb.andWhere("c.matchedMatch = :match", { match });
    }
    if (intent) {
      qb.andWhere("c.intent = :intent", { intent });
    }
    if (block) {
      const safe = block.replace(/[%_\\]/g, "");
      qb.andWhere(`CAST(c.blocks AS TEXT) ILIKE :blk`, { blk: `%${safe}%` });
    }
    if (senderJid) {
      qb.andWhere("(c.senderParticipant = :sj OR c.senderParticipant LIKE :sjEnd)", {
        sj: senderJid,
        sjEnd: `%${senderJid.split("@")[0]}%`,
      });
    }
    if (groupJid) {
      qb.andWhere("c.remoteJid = :gj", { gj: groupJid });
    }
    if (fromMs) {
      qb.andWhere("c.messageTimestampMs >= :fromMs", { fromMs });
    }
    if (toMs) {
      qb.andWhere("c.messageTimestampMs <= :toMs", { toMs });
    }
    if (beforeMs) {
      if (beforeId) {
        qb.andWhere(
          "(c.messageTimestampMs < :bms OR (c.messageTimestampMs = :bms2 AND c.messageId < :bid))",
          { bms: beforeMs, bms2: beforeMs, bid: beforeId },
        );
      } else {
        qb.andWhere("c.messageTimestampMs < :bms", { bms: beforeMs });
      }
    }

    const rows = await qb.getMany();
    res.json({ items: rows.map(serializeClassified) });
  });

  r.post("/messages/send", async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const jid = typeof b.jid === "string" ? b.jid.trim() : "";
    const text = typeof b.text === "string" ? b.text : "";
    if (!jid) {
      res.status(400).json({ error: "jid is required" });
      return;
    }
    let quoted: { remoteJid: string; messageId: string; fromMe: boolean } | undefined;
    const q = b.quotedGroupMessage;
    if (q != null && typeof q === "object" && !Array.isArray(q)) {
      const o = q as Record<string, unknown>;
      const remoteJid = typeof o.remoteJid === "string" ? o.remoteJid.trim() : "";
      const messageId = typeof o.messageId === "string" ? o.messageId.trim() : "";
      const fromMe = o.fromMe === true;
      if (remoteJid && messageId) {
        quoted = { remoteJid, messageId, fromMe };
      }
    }
    const out = await wa.sendText(jid, text, quoted ? { quoted } : undefined);
    if (!out.ok) {
      res.status(400).json({ ok: false, error: out.error });
      return;
    }
    res.json({ ok: true });
  });

  return r;
}

function serializeClassified(c: ClassifiedMessage) {
  return {
    messageId: c.messageId,
    remoteJid: c.remoteJid,
    fromMe: c.fromMe,
    intent: c.intent,
    matchedMatch: c.matchedMatch ?? null,
    isConfiguredMatch: Boolean(c.isConfiguredMatch),
    matchDate: c.matchDate ?? null,
    quantity: c.quantity ?? null,
    blocks: c.blocks ?? [],
    seats: c.seats ?? [],
    sequenceRequired: c.sequenceRequired ?? null,
    sequenceNote: c.sequenceNote ?? null,
    priceHints: c.priceHints ?? [],
    extraInfo: c.extraInfo ?? [],
    rawSnippet: c.rawSnippet ?? null,
    body: c.body ?? null,
    messageTimestampMs: c.messageTimestampMs,
    senderPushName: c.senderPushName ?? null,
    senderParticipant: c.senderParticipant ?? null,
    groupJid: c.groupJid ?? null,
    groupName: c.groupName ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

function serializeMessage(m: Message) {
  return {
    id: m.id,
    remoteJid: m.remoteJid,
    fromMe: m.fromMe,
    participant: m.participant,
    remoteJidAlt: m.remoteJidAlt,
    participantAlt: m.participantAlt,
    pushName: m.pushName,
    messageType: m.messageType,
    body: m.body,
    messageTimestampMs: m.messageTimestampMs,
    createdAt: m.createdAt.toISOString(),
    intent: m.intent ?? null,
    matchedMatch: m.matchedMatch ?? null,
  };
}

function syncMatchLabelsWithReplies(s: AutoReplySettings) {
  const fromList = (s.matches ?? [])
    .map((m) => m.trim())
    .filter(Boolean);
  const fromMap = Object.keys(s.matchReplies ?? {})
    .map((k) => k.trim())
    .filter(Boolean);
  s.matches = Array.from(new Set([...fromList, ...fromMap]));
}

function serializeSettings(s: AutoReplySettings) {
  return {
    enabled: s.enabled,
    buyEnabled: s.buyEnabled,
    sellEnabled: s.sellEnabled,
    ignoreIntent: s.ignoreIntent ?? true,
    matches: s.matches,
    matchReplies: s.matchReplies ?? {},
    replyText: s.replyText,
    cooldownMinutes: s.cooldownMinutes,
    replyExclusions: s.replyExclusions ?? [],
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function mountApi(
  app: Express,
  ctx: { wa: Wa; dataSource: DataSource; autoReply: Ar; emit: RealtimeEmits },
) {
  app.use("/api", createAppRouter(ctx));
}
