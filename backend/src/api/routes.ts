import type { Express, Request, Response } from "express";
import { Router } from "express";
import type { DataSource } from "typeorm";
import { Message } from "../db/entities/Message.js";
import { Chat } from "../db/entities/Chat.js";
import { AutoReplyLog } from "../db/entities/AutoReplyLog.js";
import { AutoReplySettings } from "../db/entities/AutoReplySettings.js";
import { ClassifiedMessage } from "../db/entities/ClassifiedMessage.js";
import { MessageTemplate } from "../db/entities/MessageTemplate.js";
import { WhatsAppAccount } from "../db/entities/WhatsAppAccount.js";
import { encrypt } from "../crypto.js";
import type { createAutoReplyService } from "../whatsapp/auto-reply.service.js";
import type { RealtimeEmits } from "../realtime/socket.gateway.js";
import type { ConnectionRegistry } from "../whatsapp/connection-registry.js";
import type { WhatsAppConnection } from "../whatsapp/connection.js";
import { chatToPayload } from "../db/chat-serialize.js";

type Ar = ReturnType<typeof createAutoReplyService>;

/** For ILIKE ... ESCAPE '\\' in PostgreSQL. */
function escapePgLikePattern(s: string): string {
  return s.replace(/\\/g, "\\\\").replace(/%/g, "\\%").replace(/_/g, "\\_");
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

export function createAppRouter(ctx: {
  registry: ConnectionRegistry;
  primaryConn: WhatsAppConnection | null;
  dataSource: DataSource;
  autoReply: Ar;
  emit: RealtimeEmits;
}) {
  const { registry, primaryConn, dataSource, autoReply, emit } = ctx;
  const r = Router();

  /** Resolve connection from accountId body field, falling back to primaryConn. */
  function resolveConnection(accountId?: string): WhatsAppConnection | null {
    if (accountId) return registry.getByAccountId(accountId);
    return primaryConn;
  }

  r.get("/accounts", (_q: Request, res: Response) => {
    res.json({ accounts: registry.list() });
  });

  r.get("/accounts/:id/status", (req: Request, res: Response) => {
    const conn = registry.getByAccountId(req.params.id);
    if (!conn) { res.status(404).json({ error: "Account not found" }); return; }
    res.json({ status: conn.getStatus() });
  });

  r.get("/accounts/:id/webhook-config", (req: Request, res: Response) => {
    const conn = registry.getByAccountId(req.params.id);
    if (!conn || conn.type !== "waba") { res.status(404).json({ error: "WABA account not found" }); return; }
    const creds = (conn as import("../whatsapp/waba.service.js").WabaConnection).getCredentials();
    res.json({
      webhookUrl: `${process.env.WABA_WEBHOOK_BASE_URL ?? ""}/api/webhooks/waba/${req.params.id}`,
      webhookVerifyToken: creds.webhookVerifyToken,
    });
  });

  r.post("/accounts/:id/connect", async (req: Request, res: Response) => {
    const conn = registry.getByAccountId(req.params.id);
    if (!conn) { res.status(404).json({ error: "Account not found" }); return; }
    if (conn.type !== "baileys") { res.status(400).json({ error: "Only Baileys accounts support connect" }); return; }
    const out = await (conn as import("../whatsapp/baileys.service.js").BaileysConnection).start();
    res.json(out);
  });

  r.post("/accounts/:id/logout", async (req: Request, res: Response) => {
    const conn = registry.getByAccountId(req.params.id);
    if (!conn) { res.status(404).json({ error: "Account not found" }); return; }
    const out = await conn.logout();
    res.json(out);
  });

  r.post("/accounts", async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    if (b.type !== "waba") {
      res.status(400).json({ error: "Only type='waba' is supported via API. Baileys is added by env." });
      return;
    }
    const displayName = typeof b.displayName === "string" ? b.displayName.trim() : "";
    const phoneNumberId = typeof b.phoneNumberId === "string" ? b.phoneNumberId.trim() : "";
    const businessAccountId = typeof b.businessAccountId === "string" ? b.businessAccountId.trim() : "";
    const accessToken = typeof b.accessToken === "string" ? b.accessToken.trim() : "";
    const appSecret = typeof b.appSecret === "string" ? b.appSecret.trim() : "";
    const webhookVerifyToken = typeof b.webhookVerifyToken === "string" ? b.webhookVerifyToken.trim() : "";
    const phoneE164 = typeof b.phoneE164 === "string" ? b.phoneE164.trim() : null;

    if (!displayName || !phoneNumberId || !businessAccountId || !accessToken || !appSecret || !webhookVerifyToken) {
      res.status(400).json({ error: "displayName, phoneNumberId, businessAccountId, accessToken, appSecret, webhookVerifyToken are required" });
      return;
    }

    let atEnc: ReturnType<typeof encrypt>, wvtEnc: ReturnType<typeof encrypt>, asEnc: ReturnType<typeof encrypt>;
    try {
      atEnc = encrypt(accessToken);
      wvtEnc = encrypt(webhookVerifyToken);
      asEnc = encrypt(appSecret);
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Encryption failed — is WABA_ENCRYPTION_KEY set?" });
      return;
    }

    const account = new WhatsAppAccount();
    account.type = "waba";
    account.displayName = displayName;
    account.phoneNumberId = phoneNumberId;
    account.businessAccountId = businessAccountId;
    account.graphApiVersion = typeof b.graphApiVersion === "string" ? b.graphApiVersion : "v22.0";
    account.isActive = true;
    if (phoneE164) account.phoneE164 = phoneE164;
    account.accessTokenEnc = atEnc.enc;
    account.accessTokenIv = atEnc.iv;
    account.accessTokenTag = atEnc.tag;
    account.webhookVerifyTokenEnc = wvtEnc.enc;
    account.webhookVerifyTokenIv = wvtEnc.iv;
    account.webhookVerifyTokenTag = wvtEnc.tag;
    account.appSecretEnc = asEnc.enc;
    account.appSecretIv = asEnc.iv;
    account.appSecretTag = asEnc.tag;

    const saved = await dataSource.getRepository(WhatsAppAccount).save(account);
    const conn = await registry.add(saved);
    res.status(201).json({
      id: saved.id,
      type: saved.type,
      displayName: saved.displayName,
      phoneE164: saved.phoneE164 ?? null,
      status: conn.getStatus(),
      isActive: saved.isActive,
      webhookUrl: `${process.env.WABA_WEBHOOK_BASE_URL ?? ""}/api/webhooks/waba/${saved.id}`,
    });
  });

  r.patch("/accounts/:id", async (req: Request, res: Response) => {
    const accountId = req.params.id;
    const repo = dataSource.getRepository(WhatsAppAccount);
    const account = await repo.findOneBy({ id: accountId });
    if (!account) { res.status(404).json({ error: "Account not found" }); return; }
    if (account.type !== "waba") { res.status(400).json({ error: "Only WABA credentials are updatable" }); return; }

    const b = (req.body ?? {}) as Record<string, unknown>;
    const updates: Array<[string, unknown]> = [];

    if (typeof b.displayName === "string" && b.displayName.trim()) {
      account.displayName = b.displayName.trim();
      updates.push(["displayName", account.displayName]);
    }
    if (typeof b.phoneNumberId === "string" && b.phoneNumberId.trim()) {
      account.phoneNumberId = b.phoneNumberId.trim();
      updates.push(["phoneNumberId", account.phoneNumberId]);
    }
    if (typeof b.businessAccountId === "string" && b.businessAccountId.trim()) {
      account.businessAccountId = b.businessAccountId.trim();
      updates.push(["businessAccountId", account.businessAccountId]);
    }
    if (typeof b.graphApiVersion === "string" && b.graphApiVersion.trim()) {
      account.graphApiVersion = b.graphApiVersion.trim();
      updates.push(["graphApiVersion", account.graphApiVersion]);
    }

    try {
      if (typeof b.accessToken === "string" && b.accessToken.trim()) {
        const e = encrypt(b.accessToken.trim());
        account.accessTokenEnc = e.enc; account.accessTokenIv = e.iv; account.accessTokenTag = e.tag;
        updates.push(["accessToken", "***"]);
      }
      if (typeof b.appSecret === "string" && b.appSecret.trim()) {
        const e = encrypt(b.appSecret.trim());
        account.appSecretEnc = e.enc; account.appSecretIv = e.iv; account.appSecretTag = e.tag;
        updates.push(["appSecret", "***"]);
      }
      if (typeof b.webhookVerifyToken === "string" && b.webhookVerifyToken.trim()) {
        const e = encrypt(b.webhookVerifyToken.trim());
        account.webhookVerifyTokenEnc = e.enc; account.webhookVerifyTokenIv = e.iv; account.webhookVerifyTokenTag = e.tag;
        updates.push(["webhookVerifyToken", "***"]);
      }
    } catch (e) {
      res.status(500).json({ error: e instanceof Error ? e.message : "Encryption failed — is WABA_ENCRYPTION_KEY set?" });
      return;
    }

    if (updates.length === 0) {
      res.status(400).json({ error: "No updatable fields provided" });
      return;
    }

    const saved = await repo.save(account);
    // Rebuild the in-memory connection so new credentials take effect immediately
    await registry.remove(accountId);
    const conn = await registry.add(saved);

    res.json({
      id: saved.id,
      type: saved.type,
      displayName: saved.displayName,
      status: conn.getStatus(),
      updated: updates.map(([k]) => k),
    });
  });

  r.delete("/accounts/:id", async (req: Request, res: Response) => {
    const accountId = req.params.id;
    const repo = dataSource.getRepository(WhatsAppAccount);
    const account = await repo.findOneBy({ id: accountId });
    if (!account) { res.status(404).json({ error: "Account not found" }); return; }
    account.isActive = false;
    await repo.save(account);
    await registry.remove(accountId);
    res.json({ ok: true });
  });

  r.get("/accounts/:id/window", async (req: Request, res: Response) => {
    const accountId = req.params.id;
    const jid = typeof req.query.jid === "string" ? req.query.jid : "";
    if (!jid) {
      res.status(400).json({ error: "jid required" });
      return;
    }
    const inWindow = await isWithin24hWindow(accountId, jid);
    res.json({ inWindow });
  });

  r.get("/accounts/:id/templates", async (req: Request, res: Response) => {
    const accountId = req.params.id;
    const conn = registry.getByAccountId(accountId);
    if (!conn) {
      res.status(404).json({ error: "Account not found" });
      return;
    }
    const templates = await dataSource.getRepository(MessageTemplate).find({
      where: { accountId },
      order: { name: "ASC" },
    });
    res.json({ templates: templates.map(serializeTemplate) });
  });

  r.post("/accounts/:id/templates/sync", async (req: Request, res: Response) => {
    const accountId = req.params.id;
    const conn = registry.getByAccountId(accountId);
    if (!conn || conn.type !== "waba") {
      res.status(404).json({ error: "WABA account not found" });
      return;
    }
    const waba = conn as import("../whatsapp/waba.service.js").WabaConnection;
    const creds = waba.getCredentials();
    const now = new Date();

    // Fetch all pages from Meta
    const fetched: MetaTemplate[] = [];
    let url: string | null =
      `https://graph.facebook.com/${creds.graphApiVersion}/${creds.businessAccountId}/message_templates?fields=name,language,category,status,components&limit=200`;

    while (url) {
      const r2 = await fetch(url, { headers: { Authorization: `Bearer ${creds.accessToken}` } });
      if (!r2.ok) {
        res.status(502).json({ error: `Meta API returned ${r2.status}` });
        return;
      }
      const page = (await r2.json()) as { data: MetaTemplate[]; paging?: { next?: string } };
      fetched.push(...page.data);
      url = page.paging?.next ?? null;
    }

    // Mark templates no longer present in Meta as DELETED
    const existingTemplates = await dataSource.getRepository(MessageTemplate).find({ where: { accountId } });
    const fetchedKey = new Set(fetched.map((t) => `${t.name}::${t.language}`));
    for (const existing of existingTemplates) {
      if (!fetchedKey.has(`${existing.name}::${existing.language}`) && existing.status !== "DELETED") {
        await dataSource.getRepository(MessageTemplate).update({ id: existing.id }, { status: "DELETED" });
      }
    }

    // Upsert from Meta
    for (const t of fetched) {
      const placeholders = extractPlaceholders(t.components);
      await dataSource.getRepository(MessageTemplate).upsert(
        {
          accountId,
          metaTemplateId: t.id ?? null,
          name: t.name,
          language: t.language,
          category: t.category,
          status: t.status,
          componentsJson: t.components as unknown as object,
          placeholdersJson: placeholders,
          lastSyncedAt: now,
        },
        { conflictPaths: ["accountId", "name", "language"] },
      );
    }

    const templates = await dataSource.getRepository(MessageTemplate).find({ where: { accountId }, order: { name: "ASC" } });
    res.json({ synced: fetched.length, templates: templates.map(serializeTemplate) });
  });

  r.get("/session/status", (_q: Request, res: Response) => {
    const conn = primaryConn;
    res.json({ status: conn?.getStatus() ?? "idle" });
  });

  r.post("/session/start", async (_q: Request, res: Response) => {
    const conn = primaryConn;
    if (!conn || conn.type !== "baileys") {
      res.status(400).json({ error: "No Baileys account configured" });
      return;
    }
    const out = await (conn as import("../whatsapp/baileys.service.js").BaileysConnection).start();
    res.json(out);
  });

  r.post("/session/logout", async (_q: Request, res: Response) => {
    const conn = primaryConn;
    if (!conn) {
      res.status(400).json({ error: "No primary account" });
      return;
    }
    const out = await conn.logout();
    res.json(out);
  });

  r.get("/chats", async (req: Request, res: Response) => {
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
    const qb = dataSource.getRepository(Chat)
      .createQueryBuilder("c")
      .orderBy("c.lastMessageAt", "DESC");
    if (accountId) {
      qb.where("c.accountId = :accountId", { accountId });
    }
    const rows = await qb.getMany();
    res.json({ chats: rows.map(chatToPayload) });
  });

  r.get("/chats/auto-reply-threads", async (req: Request, res: Response) => {
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
    const qb = dataSource
      .getRepository(AutoReplyLog)
      .createQueryBuilder("l")
      .select("DISTINCT l.counterpartyJid", "jid")
      .where("l.counterpartyJid != :empty", { empty: "" })
      .andWhere("l.counterpartyJid NOT LIKE :gus", { gus: "%@g.us" });
    if (accountId) {
      qb.andWhere("l.accountId = :accountId", { accountId });
    }
    const rows = await qb.getRawMany<{ jid: string }>();
    const jids = rows.map((r) => r.jid).filter((j): j is string => Boolean(j?.trim()));
    res.json({ jids });
  });

  r.post("/chats/:jid/read", async (req: Request, res: Response) => {
    const jid = req.params.jid;
    const accountId = typeof req.body?.accountId === "string" ? req.body.accountId : undefined;
    if (!jid) {
      res.status(400).json({ error: "jid required" });
      return;
    }
    const conn = resolveConnection(accountId);
    if (!conn) {
      res.status(400).json({ error: "Account not found" });
      return;
    }
    const repo = dataSource.getRepository(Chat);
    const row = await repo.findOne({ where: { accountId: conn.accountId, jid } });
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
    if (typeof b.enabled === "boolean") s.enabled = b.enabled;
    if (typeof b.buyEnabled === "boolean") s.buyEnabled = b.buyEnabled;
    if (typeof b.sellEnabled === "boolean") s.sellEnabled = b.sellEnabled;
    if (typeof b.ignoreIntent === "boolean") s.ignoreIntent = b.ignoreIntent;
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
    if (typeof b.replyText === "string") s.replyText = b.replyText;
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
        const ri = item as Record<string, unknown>;
        if (typeof ri.name !== "string" || typeof ri.value !== "string") {
          res.status(400).json({ error: "replyExclusion entries need string name and value" });
          return;
        }
        out.push({ name: ri.name.trim(), value: ri.value.trim() });
      }
      s.replyExclusions = out.filter((x) => x.value.length > 0);
    }
    if (b.replyRouting != null && typeof b.replyRouting === "object" && !Array.isArray(b.replyRouting)) {
      s.replyRouting = b.replyRouting as Record<string, import("../db/entities/AutoReplySettings.js").MatchRouting>;
    }
    syncMatchLabelsWithReplies(s);
    await repo.save(s);
    autoReply.invalidateSettingsCache();
    const fresh = await autoReply.getSettings(true);
    emit.emitSettingsUpdated(serializeSettings(fresh) as unknown as Record<string, unknown>);
    res.json(serializeSettings(fresh));
  });

  r.get("/auto-replies/stats", async (req: Request, res: Response) => {
    const fromMs = Number.parseInt(String(req.query.fromMs ?? ""), 10);
    const toMs = Number.parseInt(String(req.query.toMs ?? ""), 10);
    const maxRange = 48 * 60 * 60 * 1000;
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs) || toMs <= fromMs || toMs - fromMs > maxRange) {
      res.status(400).json({ error: "valid fromMs and toMs required (toMs > fromMs, range ≤ 48h)" });
      return;
    }
    const from = new Date(fromMs);
    const to = new Date(toMs);
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
    const rows = await dataSource.query<Array<{ c: string | number }>>(
      `SELECT COUNT(DISTINCT counterparty_jid)::text AS c
       FROM auto_reply_log
       WHERE sent_at >= $1 AND sent_at < $2
         AND counterparty_jid <> ''
         AND counterparty_jid NOT LIKE $3
         ${accountId ? "AND account_id = $4" : ""}`,
      accountId ? [from, to, "%@g.us", accountId] : [from, to, "%@g.us"],
    );
    const uniqueRecipientsToday = Number.parseInt(String(rows[0]?.c ?? "0"), 10) || 0;
    res.json({ uniqueRecipientsToday });
  });

  r.get("/auto-replies", async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50), 200);
    const rows = await dataSource.getRepository(AutoReplyLog).find({
      order: { sentAt: "DESC" },
      take: limit,
    });
    res.json({ log: rows });
  });

  r.get("/messages", async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(1, Number.parseInt(String(req.query.limit ?? "50"), 10) || 50), 200);
    const remoteJid = req.query.remoteJid ? String(req.query.remoteJid) : undefined;
    const beforeMs = req.query.before ? String(req.query.before) : undefined;
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
    const conn = resolveConnection(accountId);

    const qb = dataSource
      .getRepository(Message)
      .createQueryBuilder("m")
      .orderBy("m.messageTimestampMs", "DESC")
      .addOrderBy("m.id", "ASC")
      .take(limit);

    if (conn) {
      qb.andWhere("m.accountId = :accountId", { accountId: conn.accountId });
    }
    if (remoteJid) qb.andWhere("m.remoteJid = :rj", { rj: remoteJid });
    if (beforeMs) qb.andWhere("m.messageTimestampMs < :b", { b: beforeMs });

    const messages = await qb.getMany();
    res.json({ messages: messages.map(serializeMessage) });
  });

  r.get("/classified-messages/facets", async (req: Request, res: Response) => {
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
    const repo = dataSource.getRepository(ClassifiedMessage);

    const matchQb = repo.createQueryBuilder("c")
      .select("DISTINCT c.matchedMatch", "m")
      .where("c.matchedMatch IS NOT NULL")
      .orderBy("m", "ASC")
      .limit(80);
    if (accountId) matchQb.andWhere("c.accountId = :accountId", { accountId });
    const matchesRaw = await matchQb.getRawMany<{ m: string }>();
    const matches = matchesRaw.map((r) => r.m).filter((m): m is string => Boolean(m?.trim()));

    const recentQb = repo.createQueryBuilder("c")
      .orderBy("c.messageTimestampMs", "DESC")
      .take(800);
    if (accountId) recentQb.where("c.accountId = :accountId", { accountId });
    const recent = await recentQb.getMany();

    const blockCounts = new Map<string, number>();
    for (const row of recent) {
      for (const b of row.blocks ?? []) {
        const k = String(b).trim();
        if (!k) continue;
        blockCounts.set(k, (blockCounts.get(k) ?? 0) + 1);
      }
    }
    const blocks = [...blockCounts.entries()]
      .sort((a, b) => b[1] - a[1]).slice(0, 40)
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
    const senders = [...senderCounts.values()].sort((a, b) => b.count - a.count).slice(0, 50);

    res.json({ matches, blocks, senders });
  });

  r.get("/classified-messages", async (req: Request, res: Response) => {
    const limit = Math.min(Math.max(1, Number.parseInt(String(req.query.limit ?? "80"), 10) || 80), 200);
    const match = req.query.match ? String(req.query.match).trim() : undefined;
    const intent = req.query.intent ? String(req.query.intent).trim().toLowerCase() : undefined;
    const block = req.query.block ? String(req.query.block).trim() : undefined;
    const senderJid = req.query.senderJid ? String(req.query.senderJid).trim() : undefined;
    const groupJid = req.query.groupJid ? String(req.query.groupJid).trim() : undefined;
    const fromMs = req.query.fromMs != null ? String(req.query.fromMs) : undefined;
    const toMs = req.query.toMs != null ? String(req.query.toMs) : undefined;
    const beforeMs = req.query.beforeMs != null ? String(req.query.beforeMs) : undefined;
    const beforeId = req.query.beforeId != null ? String(req.query.beforeId) : undefined;
    const accountId = req.query.accountId ? String(req.query.accountId) : undefined;
    const onlyIncoming = String(req.query.onlyIncoming ?? "true").toLowerCase() !== "false";
    const configuredOnly = String(req.query.configuredOnly ?? "").toLowerCase() === "true";

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

    if (accountId) qb.andWhere("c.accountId = :accountId", { accountId });
    if (onlyIncoming) qb.andWhere("c.fromMe = :fm", { fm: false });
    if (configuredOnly) qb.andWhere("c.isConfiguredMatch = :icm", { icm: true });
    if (match) qb.andWhere("c.matchedMatch = :match", { match });
    if (intent) qb.andWhere("c.intent = :intent", { intent });
    if (block) {
      const blkPat = `%${escapePgLikePattern(block)}%`;
      qb.andWhere(
        `(CAST(c.blocks AS TEXT) ILIKE :blkPat ESCAPE '\\' OR COALESCE(c.body, '') ILIKE :blkPat ESCAPE '\\' OR COALESCE(c.rawSnippet, '') ILIKE :blkPat ESCAPE '\\')`,
        { blkPat },
      );
    }
    if (senderJid) {
      const raw = senderJid;
      const ors: string[] = [];
      const senderParams: Record<string, string> = {};
      ors.push("(c.senderParticipant = :senderPartEq OR c.senderParticipantAlt = :senderPartEq)");
      if (raw.includes("@")) {
        const local = raw.split("@")[0] ?? "";
        if (local.length > 0) {
          ors.push("(c.senderParticipant ILIKE :senderPartLocal ESCAPE '\\' OR c.senderParticipantAlt ILIKE :senderPartLocal ESCAPE '\\')");
          senderParams.senderPartLocal = `%${escapePgLikePattern(local)}%`;
        }
      }
      ors.push(`COALESCE(c.senderPushName, '') ILIKE :senderPushPat ESCAPE '\\'`);
      senderParams.senderPushPat = `%${escapePgLikePattern(raw)}%`;
      const d = digitsOnly(raw);
      if (d.length > 0) {
        const digExpr = `regexp_replace(split_part(COALESCE(%COL%, ''), '@', 1), '[^0-9]', '', 'g') LIKE :senderDigPat ESCAPE '\\'`;
        ors.push(`(${digExpr.replace("%COL%", "c.senderParticipant")} OR ${digExpr.replace("%COL%", "c.senderParticipantAlt")})`);
        senderParams.senderDigPat = `%${d}%`;
      }
      qb.andWhere(`(${ors.join(" OR ")})`, { ...senderParams, senderPartEq: raw });
    }
    if (groupJid) {
      if (groupJid.includes("@")) {
        qb.andWhere("c.remoteJid = :gj", { gj: groupJid });
      } else {
        const safe = groupJid.replace(/[%_\\]/g, "");
        if (safe) qb.andWhere("LOWER(COALESCE(c.groupName, '')) LIKE :gn", { gn: `%${safe.toLowerCase()}%` });
      }
    }
    if (fromMs) qb.andWhere("c.messageTimestampMs >= :fromMs", { fromMs });
    if (toMs) qb.andWhere("c.messageTimestampMs <= :toMs", { toMs });
    if (beforeMs) {
      if (beforeId) {
        qb.andWhere("(c.messageTimestampMs < :bms OR (c.messageTimestampMs = :bms2 AND c.messageId < :bid))", { bms: beforeMs, bms2: beforeMs, bid: beforeId });
      } else {
        qb.andWhere("c.messageTimestampMs < :bms", { bms: beforeMs });
      }
    }

    const rows = await qb.getMany();
    res.json({ items: rows.map(serializeClassified) });
  });

  /** Returns true if the customer sent a message to this account within the last 24 hours. */
  async function isWithin24hWindow(accountId: string, jid: string): Promise<boolean> {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const row = await dataSource
      .getRepository(Message)
      .createQueryBuilder("m")
      .where("m.accountId = :accountId", { accountId })
      .andWhere("m.remoteJid = :jid", { jid })
      .andWhere("m.fromMe = false")
      .andWhere("m.createdAt >= :cutoff", { cutoff })
      .orderBy("m.createdAt", "DESC")
      .getOne();
    return row != null;
  }

  /** Get most recent inbound wamid for contextual reply threading. */
  async function latestInboundWamid(accountId: string, jid: string): Promise<string | null> {
    const row = await dataSource
      .getRepository(Message)
      .createQueryBuilder("m")
      .where("m.accountId = :accountId", { accountId })
      .andWhere("m.remoteJid = :jid", { jid })
      .andWhere("m.fromMe = false")
      .andWhere("m.provider = 'waba'")
      .orderBy("m.createdAt", "DESC")
      .getOne();
    return row?.id ?? null;
  }

  r.post("/messages/send", async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const jid = typeof b.jid === "string" ? b.jid.trim() : "";
    const text = typeof b.text === "string" ? b.text : "";
    const accountId = typeof b.accountId === "string" ? b.accountId : undefined;
    const templateId = typeof b.templateId === "string" ? b.templateId.trim() : undefined;
    const templateParams = b.templateParams && typeof b.templateParams === "object" && !Array.isArray(b.templateParams)
      ? (b.templateParams as Record<string, string>)
      : undefined;

    if (!jid) {
      res.status(400).json({ error: "jid is required" });
      return;
    }
    const conn = resolveConnection(accountId);
    if (!conn) {
      res.status(400).json({ error: "ACCOUNT_NOT_FOUND" });
      return;
    }

    // Block WABA → group sends
    if (conn.type === "waba" && jid.endsWith("@g.us")) {
      res.status(400).json({ error: "WABA cannot send to groups" });
      return;
    }

    // Template send path
    if (templateId) {
      const tmpl = await dataSource.getRepository(MessageTemplate).findOne({
        where: { accountId: conn.accountId, name: templateId },
      });
      if (!tmpl) {
        res.status(400).json({ error: "TEMPLATE_NOT_FOUND" });
        return;
      }
      if (tmpl.status !== "APPROVED") {
        res.status(400).json({ error: "TEMPLATE_NOT_APPROVED", status: tmpl.status });
        return;
      }
      const placeholders: string[] = Array.isArray(tmpl.placeholdersJson) ? tmpl.placeholdersJson : [];
      const components = placeholders.length > 0
        ? [{
            type: "body" as const,
            parameters: placeholders.map((k) => ({
              type: "text" as const,
              text: templateParams?.[k] ?? "",
            })),
          }]
        : [];
      const out = await conn.sendTemplate(jid, { templateId, language: tmpl.language, components });
      if (!out.ok) {
        res.status(400).json({ ok: false, error: out.error });
        return;
      }
      res.json({ ok: true, providerMessageId: out.providerMessageId ?? null });
      return;
    }

    // Text send: WABA 24h window check
    if (conn.type === "waba") {
      const inWindow = await isWithin24hWindow(conn.accountId, jid);
      if (!inWindow) {
        res.status(400).json({ error: "TEMPLATE_REQUIRED", reason: "Outside 24-hour customer service window" });
        return;
      }
      // Inject contextWamid for WABA reply threading
      const contextWamid = await latestInboundWamid(conn.accountId, jid);
      const out = await conn.sendText(jid, text, contextWamid ? { contextWamid } : undefined);
      if (!out.ok) {
        res.status(400).json({ ok: false, error: out.error });
        return;
      }
      res.json({ ok: true, providerMessageId: out.providerMessageId ?? null });
      return;
    }

    // Baileys text send (supports quotes)
    const quoted = parseQuotedGroupMessage(b);
    const out = await conn.sendText(jid, text, quoted ? { quoted } : undefined);
    if (!out.ok) {
      res.status(400).json({ ok: false, error: out.error });
      return;
    }
    res.json({ ok: true, providerMessageId: out.providerMessageId ?? null });
  });

  r.post("/messages/send-bulk", async (req: Request, res: Response) => {
    const b = (req.body ?? {}) as Record<string, unknown>;
    const accountId = typeof b.accountId === "string" ? b.accountId : undefined;
    const targetsRaw = b.targets;

    if (!Array.isArray(targetsRaw)) {
      res.status(400).json({ error: "targets must be an array" });
      return;
    }
    if (targetsRaw.length > 25) {
      res.status(400).json({ error: "max 25 targets" });
      return;
    }
    const conn = resolveConnection(accountId);
    if (!conn) {
      res.status(400).json({ error: "ACCOUNT_NOT_FOUND" });
      return;
    }

    const results: { jid: string; ok: boolean; error?: string }[] = [];
    for (const t of targetsRaw) {
      if (!t || typeof t !== "object" || Array.isArray(t)) {
        results.push({ jid: "", ok: false, error: "invalid target" });
        continue;
      }
      const o = t as Record<string, unknown>;
      const jid = typeof o.jid === "string" ? o.jid.trim() : "";
      if (!jid) {
        results.push({ jid: "", ok: false, error: "missing jid" });
        continue;
      }

      // Per-target text override, or fall back to top-level text
      const text = typeof o.text === "string" ? o.text : (typeof b.text === "string" ? b.text : "");
      const templateId = typeof o.templateId === "string" ? o.templateId : undefined;
      const templateParams = o.templateParams && typeof o.templateParams === "object" && !Array.isArray(o.templateParams)
        ? (o.templateParams as Record<string, string>)
        : undefined;

      let out: { ok: true; providerMessageId?: string } | { ok: false; error: string };

      if (conn.type === "waba" && jid.endsWith("@g.us")) {
        out = { ok: false, error: "WABA cannot send to groups" };
      } else if (templateId) {
        const tmpl = await dataSource.getRepository(MessageTemplate).findOne({
          where: { accountId: conn.accountId, name: templateId },
        });
        if (!tmpl || tmpl.status !== "APPROVED") {
          out = { ok: false, error: tmpl ? "TEMPLATE_NOT_APPROVED" : "TEMPLATE_NOT_FOUND" };
        } else {
          const placeholders: string[] = Array.isArray(tmpl.placeholdersJson) ? tmpl.placeholdersJson : [];
          const components = placeholders.length > 0
            ? [{ type: "body" as const, parameters: placeholders.map((k) => ({ type: "text" as const, text: templateParams?.[k] ?? "" })) }]
            : [];
          out = await conn.sendTemplate(jid, { templateId, language: tmpl.language, components });
        }
      } else if (conn.type === "waba") {
        const inWindow = await isWithin24hWindow(conn.accountId, jid);
        if (!inWindow) {
          out = { ok: false, error: "TEMPLATE_REQUIRED" };
        } else {
          const contextWamid = await latestInboundWamid(conn.accountId, jid);
          out = await conn.sendText(jid, text, contextWamid ? { contextWamid } : undefined);
        }
      } else {
        const quoted = parseQuotedGroupMessage(o);
        out = await conn.sendText(jid, text, quoted ? { quoted } : undefined);
      }

      results.push(out.ok ? { jid, ok: true } : { jid, ok: false, error: out.error });

      // 50-150ms jitter between sends to avoid burst-rate limits
      await new Promise((resolve) => setTimeout(resolve, 50 + Math.floor(Math.random() * 100)));
    }

    const sent = results.filter((r) => r.ok).length;
    const failed = results.length - sent;
    res.json({ results, sent, failed });
  });

  return r;
}

interface MetaTemplate {
  id?: string;
  name: string;
  language: string;
  category: string;
  status: string;
  components?: Array<{
    type: string;
    text?: string;
    format?: string;
    buttons?: unknown[];
  }>;
}

function extractPlaceholders(components?: MetaTemplate["components"]): string[] {
  if (!components) return [];
  const placeholders: string[] = [];
  for (const c of components) {
    const text = c.text ?? "";
    const matches = text.matchAll(/\{\{(\d+)\}\}/g);
    for (const m of matches) {
      if (!placeholders.includes(m[1])) placeholders.push(m[1]);
    }
  }
  return placeholders.sort((a, b) => Number(a) - Number(b));
}

function serializeTemplate(t: MessageTemplate) {
  return {
    id: t.id,
    accountId: t.accountId,
    name: t.name,
    language: t.language,
    category: t.category,
    status: t.status,
    placeholders: t.placeholdersJson ?? [],
    lastSyncedAt: t.lastSyncedAt?.toISOString() ?? null,
  };
}

function parseQuotedGroupMessage(b: Record<string, unknown>): { remoteJid: string; messageId: string; fromMe: boolean } | undefined {
  const q = b.quotedGroupMessage;
  if (q == null || typeof q !== "object" || Array.isArray(q)) return undefined;
  const o = q as Record<string, unknown>;
  const remoteJid = typeof o.remoteJid === "string" ? o.remoteJid.trim() : "";
  const messageId = typeof o.messageId === "string" ? o.messageId.trim() : "";
  const fromMe = o.fromMe === true;
  if (remoteJid && messageId) return { remoteJid, messageId, fromMe };
  return undefined;
}

function serializeClassified(c: ClassifiedMessage) {
  return {
    accountId: c.accountId,
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
    senderParticipantAlt: c.senderParticipantAlt ?? null,
    groupJid: c.groupJid ?? null,
    groupName: c.groupName ?? null,
    createdAt: c.createdAt.toISOString(),
  };
}

function serializeMessage(m: Message) {
  return {
    accountId: m.accountId,
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
  const fromList = (s.matches ?? []).map((m) => m.trim()).filter(Boolean);
  const fromMap = Object.keys(s.matchReplies ?? {}).map((k) => k.trim()).filter(Boolean);
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
    replyRouting: s.replyRouting ?? {},
    defaultRouting: s.defaultRouting ?? null,
    updatedAt: s.updatedAt.toISOString(),
  };
}

export function mountApi(
  app: Express,
  ctx: {
    registry: ConnectionRegistry;
    primaryConn: WhatsAppConnection | null;
    dataSource: DataSource;
    autoReply: Ar;
    emit: RealtimeEmits;
  },
) {
  app.use("/api", createAppRouter(ctx));
}
