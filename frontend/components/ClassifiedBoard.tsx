"use client";

import Link from "next/link";
import { useCallback, useEffect, useLayoutEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  CheckSquare,
  Eraser,
  LayoutList,
  Radio,
  RefreshCw,
  Send,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { ConversationView } from "@/components/ConversationView";
import { AccountSelector } from "@/components/AccountSelector";
import { getJson, postJson } from "@/lib/api";
import {
  classifiedBulkTargetFromItem,
  classifiedRowKey,
  replyPrivatelyJid,
} from "@/lib/classified-bulk-send";
import { cn } from "@/lib/utils";
import { getSocket } from "@/lib/socket";
import { useSocketEvent } from "@/lib/use-socket-event";
import type {
  ChatRow,
  ClassifiedFacetsDto,
  ClassifiedMessageDto,
  ConnectionState,
  GroupMessageReplyRef,
  SocketEventMap,
} from "@/lib/types";
import {
  classifiedSenderPhoneDisplay,
  isLidWhatsAppJid,
  shortJidForUi,
} from "@/lib/whatsapp-display";

type ItemsResp = { items: ClassifiedMessageDto[] };

type BulkSendResponse = {
  results: { jid: string; ok: boolean; error?: string }[];
  sent: number;
  failed: number;
};

type SessionStatus = { status: string };

function classifiedCardDisplayTitle(item: ClassifiedMessageDto): string {
  const push = item.senderPushName?.trim();
  if (push) return push;
  const phone = classifiedSenderPhoneDisplay(item);
  if (phone) return phone;
  const sj = shortJidForUi(item.senderParticipant ?? null);
  if (sj) return sj;
  return item.remoteJid.endsWith("@g.us") ? "Group member" : "Unknown sender";
}

function classifiedCardSubtitleLine(item: ClassifiedMessageDto, titleStr: string): string | null {
  const phone = classifiedSenderPhoneDisplay(item);
  if (phone && titleStr !== phone) return phone;
  const sj = shortJidForUi(item.senderParticipant ?? null);
  if (sj && sj !== titleStr) return sj;
  return null;
}

function safeClassifiedCardListTitle(
  titleStr: string,
  secondary: string | null,
  groupName: string | null | undefined,
): string | undefined {
  const bits = [titleStr, secondary, groupName?.trim()].filter(Boolean);
  const s = bits.join(" · ");
  return s || undefined;
}

function fmtTime(ms: string) {
  const n = Number(ms);
  if (!Number.isFinite(n)) return "";
  return new Date(n).toLocaleString(undefined, {
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function matchesGroupQuery(item: ClassifiedMessageDto, raw: string): boolean {
  const q = raw.trim();
  if (!q) return true;
  if (q.includes("@")) {
    return item.remoteJid === q;
  }
  const needle = q.toLowerCase();
  const name = (item.groupName ?? "").toLowerCase();
  return name.includes(needle);
}

function digitsOnly(s: string): string {
  return s.replace(/\D/g, "");
}

/** Mirrors `/api/classified-messages` `senderJid` query param (see backend `routes.ts`). */
function matchesSenderQuery(
  raw: string,
  participant: string | null | undefined,
  participantAlt: string | null | undefined,
  pushName: string | null | undefined,
): boolean {
  const q = raw.trim();
  if (!q) return true;

  const p = (participant ?? "").trim();
  const a = (participantAlt ?? "").trim();
  const n = (pushName ?? "").trim();

  if (p === q || a === q) return true;

  if (q.includes("@")) {
    const local = (q.split("@")[0] ?? "").toLowerCase();
    if (local) {
      const pUser = p.includes("@") ? p.split("@")[0]! : p;
      const aUser = a.includes("@") ? a.split("@")[0]! : a;
      if (pUser.toLowerCase().includes(local) || aUser.toLowerCase().includes(local)) return true;
    }
  }

  const qLower = q.toLowerCase();
  if (n.toLowerCase().includes(qLower)) return true;

  const dQ = digitsOnly(q);
  if (dQ.length > 0) {
    const pUser = p.includes("@") ? p.split("@")[0]! : p;
    const aUser = a.includes("@") ? a.split("@")[0]! : a;
    if (digitsOnly(pUser).includes(dQ) || digitsOnly(aUser).includes(dQ)) return true;
  }

  return false;
}

function matchesFilters(
  item: ClassifiedMessageDto,
  opts: {
    match: string;
    intent: string;
    block: string;
    senderQuery: string;
    groupQuery: string;
    onlyIncoming: boolean;
    configuredOnly: boolean;
  },
): boolean {
  if (opts.onlyIncoming && item.fromMe) return false;
  if (opts.configuredOnly && !Boolean(item.isConfiguredMatch)) return false;
  if (opts.match && item.matchedMatch !== opts.match) return false;
  if (opts.intent && item.intent !== opts.intent) return false;
  if (opts.block) {
    const needle = opts.block.toLowerCase();
    const blocksHay = (item.blocks ?? []).join(" ").toLowerCase();
    const bodyHay = (item.body ?? "").toLowerCase();
    const snippetHay = (item.rawSnippet ?? "").toLowerCase();
    if (
      !blocksHay.includes(needle) &&
      !bodyHay.includes(needle) &&
      !snippetHay.includes(needle)
    ) {
      return false;
    }
  }
  if (
    opts.senderQuery &&
    !matchesSenderQuery(
      opts.senderQuery,
      item.senderParticipant,
      item.senderParticipantAlt,
      item.senderPushName,
    )
  ) {
    return false;
  }
  if (opts.groupQuery && !matchesGroupQuery(item, opts.groupQuery)) return false;
  return true;
}

function inlineChatRowFromItem(dmJid: string, item: ClassifiedMessageDto): ChatRow {
  const phone = classifiedSenderPhoneDisplay(item);
  const push = item.senderPushName?.trim();
  const name = push && phone ? `${push} · ${phone}` : push || phone || null;
  return {
    jid: dmJid,
    name,
    isGroup: dmJid.endsWith("@g.us"),
    lastMessageAt: null,
    unreadCount: 0,
    updatedAt: new Date().toISOString(),
    lastMessageBody: null,
    lastMessageType: null,
    lastMessageFromMe: null,
    lastSenderName: null,
  };
}

const CLASSIFIED_FILTERS_STORAGE_KEY = "classified-board-filters";

type PersistedClassifiedFilters = {
  match: string;
  intent: string;
  block: string;
  senderQuery: string;
  groupQuery: string;
  onlyIncoming: boolean;
  watchedMatchesOnly: boolean;
};

const DEFAULT_CLASSIFIED_FILTERS: PersistedClassifiedFilters = {
  match: "",
  intent: "",
  block: "",
  senderQuery: "",
  groupQuery: "",
  onlyIncoming: true,
  watchedMatchesOnly: false,
};

function readPersistedFilters(): PersistedClassifiedFilters | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = sessionStorage.getItem(CLASSIFIED_FILTERS_STORAGE_KEY);
    if (!raw) return null;
    const o = JSON.parse(raw) as unknown;
    if (!o || typeof o !== "object") return null;
    const r = o as Record<string, unknown>;
    const groupQueryFromDisk =
      typeof r.groupQuery === "string"
        ? r.groupQuery
        : typeof r.groupJid === "string"
          ? r.groupJid
          : DEFAULT_CLASSIFIED_FILTERS.groupQuery;
    return {
      match: typeof r.match === "string" ? r.match : DEFAULT_CLASSIFIED_FILTERS.match,
      intent: typeof r.intent === "string" ? r.intent : DEFAULT_CLASSIFIED_FILTERS.intent,
      block: typeof r.block === "string" ? r.block : DEFAULT_CLASSIFIED_FILTERS.block,
      senderQuery:
        typeof r.senderQuery === "string"
          ? r.senderQuery
          : typeof r.senderJid === "string"
            ? r.senderJid
            : DEFAULT_CLASSIFIED_FILTERS.senderQuery,
      groupQuery: groupQueryFromDisk,
      onlyIncoming:
        typeof r.onlyIncoming === "boolean" ? r.onlyIncoming : DEFAULT_CLASSIFIED_FILTERS.onlyIncoming,
      watchedMatchesOnly:
        typeof r.watchedMatchesOnly === "boolean"
          ? r.watchedMatchesOnly
          : DEFAULT_CLASSIFIED_FILTERS.watchedMatchesOnly,
    };
  } catch {
    return null;
  }
}

function writePersistedFilters(f: PersistedClassifiedFilters) {
  try {
    sessionStorage.setItem(CLASSIFIED_FILTERS_STORAGE_KEY, JSON.stringify(f));
  } catch {
    // ignore quota / private mode
  }
}

export function ClassifiedBoard() {
  const [facets, setFacets] = useState<ClassifiedFacetsDto | null>(null);
  const [items, setItems] = useState<ClassifiedMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [filtersReady, setFiltersReady] = useState(false);
  const [match, setMatch] = useState(DEFAULT_CLASSIFIED_FILTERS.match);
  const [intent, setIntent] = useState(DEFAULT_CLASSIFIED_FILTERS.intent);
  const [block, setBlock] = useState(DEFAULT_CLASSIFIED_FILTERS.block);
  const [senderQuery, setSenderQuery] = useState(DEFAULT_CLASSIFIED_FILTERS.senderQuery);
  const [groupQuery, setGroupQuery] = useState(DEFAULT_CLASSIFIED_FILTERS.groupQuery);
  const [onlyIncoming, setOnlyIncoming] = useState(DEFAULT_CLASSIFIED_FILTERS.onlyIncoming);
  const [watchedMatchesOnly, setWatchedMatchesOnly] = useState(DEFAULT_CLASSIFIED_FILTERS.watchedMatchesOnly);

  const [conn, setConn] = useState<ConnectionState>("idle");
  const [inlineJid, setInlineJid] = useState<string | null>(null);
  const [inlineChat, setInlineChat] = useState<ChatRow | null>(null);
  const [privateReplyQuote, setPrivateReplyQuote] = useState<GroupMessageReplyRef | null>(null);
  const [mobileShowChat, setMobileShowChat] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<Set<string>>(() => new Set());
  const [bulkMessage, setBulkMessage] = useState("");
  const [bulkSending, setBulkSending] = useState(false);
  const [bulkSummary, setBulkSummary] = useState<string | null>(null);
  const [bulkAccountId, setBulkAccountId] = useState<string | null>(null);

  useLayoutEffect(() => {
    const stored = readPersistedFilters();
    if (stored) {
      setMatch(stored.match);
      setIntent(stored.intent);
      setBlock(stored.block);
      setSenderQuery(stored.senderQuery);
      setGroupQuery(stored.groupQuery);
      setOnlyIncoming(stored.onlyIncoming);
      setWatchedMatchesOnly(stored.watchedMatchesOnly);
    }
    setFiltersReady(true);
  }, []);

  useEffect(() => {
    if (!filtersReady) return;
    writePersistedFilters({
      match,
      intent,
      block,
      senderQuery,
      groupQuery,
      onlyIncoming,
      watchedMatchesOnly,
    });
  }, [filtersReady, match, intent, block, senderQuery, groupQuery, onlyIncoming, watchedMatchesOnly]);

  const filterOpts = useMemo(
    () => ({
      match,
      intent,
      block,
      senderQuery,
      groupQuery,
      onlyIncoming,
      configuredOnly: watchedMatchesOnly,
    }),
    [match, intent, block, senderQuery, groupQuery, onlyIncoming, watchedMatchesOnly],
  );

  const loadFacets = useCallback(async () => {
    try {
      const f = await getJson<ClassifiedFacetsDto>("/api/classified-messages/facets");
      setFacets(f);
    } catch {
      // keep prior
    }
  }, []);

  const loadItems = useCallback(async () => {
    setLoading(true);
    setErr(null);
    try {
      const q = new URLSearchParams();
      q.set("limit", "80");
      if (match) q.set("match", match);
      if (intent) q.set("intent", intent);
      if (block) q.set("block", block);
      if (senderQuery) q.set("senderJid", senderQuery);
      if (groupQuery) q.set("groupJid", groupQuery);
      q.set("onlyIncoming", onlyIncoming ? "true" : "false");
      if (watchedMatchesOnly) q.set("configuredOnly", "true");
      const r = await getJson<ItemsResp>(`/api/classified-messages?${q.toString()}`);
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [match, intent, block, senderQuery, groupQuery, onlyIncoming, watchedMatchesOnly]);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  useEffect(() => {
    if (!filtersReady) return;
    void loadItems();
  }, [filtersReady, loadItems]);

  useEffect(() => {
    getSocket();
  }, []);

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => {
      if (mq.matches) setMobileShowChat(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  useEffect(() => {
    void getJson<SessionStatus>("/api/session/status")
      .then((s) => setConn((s?.status as ConnectionState) || "idle"))
      .catch(() => {});
  }, []);

  useSocketEvent("connection:state", (d) => {
    const p = d as { state?: string };
    if (p?.state) setConn(p.state as ConnectionState);
  });

  useSocketEvent("message:classified", (d) => {
    if (!filtersReady) return;
    const p = d as SocketEventMap["message:classified"];
    if (!p?.messageId) return;
    if (!matchesFilters(p, filterOpts)) return;
    setItems((prev) => {
      const key = classifiedRowKey(p);
      if (prev.some((x) => classifiedRowKey(x) === key)) {
        return prev;
      }
      return [p, ...prev].sort((a, b) => Number(b.messageTimestampMs) - Number(a.messageTimestampMs));
    });
  });

  const openInlineChat = useCallback((item: ClassifiedMessageDto) => {
    const dmJid = replyPrivatelyJid(item);
    const isGroupCard = item.remoteJid.endsWith("@g.us") && Boolean(item.senderParticipant?.trim());
    setInlineJid(dmJid);
    setInlineChat(inlineChatRowFromItem(dmJid, item));
    if (isGroupCard) {
      setPrivateReplyQuote({
        remoteJid: item.remoteJid,
        messageId: item.messageId,
        fromMe: Boolean(item.fromMe),
      });
    } else {
      setPrivateReplyQuote(null);
    }
    if (typeof window !== "undefined" && !window.matchMedia("(min-width: 640px)").matches) {
      setMobileShowChat(true);
    }
  }, []);

  const closeInlineChat = useCallback(() => {
    setInlineJid(null);
    setInlineChat(null);
    setPrivateReplyQuote(null);
    setMobileShowChat(false);
  }, []);

  const toggleSelectedKey = useCallback((key: string) => {
    setSelectedKeys((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);

  const clearBulkSelection = useCallback(() => {
    setSelectedKeys(new Set());
    setBulkSummary(null);
  }, []);

  const sendBulkDms = useCallback(async () => {
    const text = bulkMessage.trim();
    if (!text || selectedKeys.size === 0 || conn !== "open") return;
    setBulkSending(true);
    setBulkSummary(null);
    try {
      const ordered = items.filter((item) => selectedKeys.has(classifiedRowKey(item)));
      const capped = ordered.slice(0, 25);
      const targets = capped.map(classifiedBulkTargetFromItem);
      const payload: Record<string, unknown> = { text, targets };
      if (bulkAccountId) payload.accountId = bulkAccountId;
      const resp = await postJson<BulkSendResponse>("/api/messages/send-bulk", payload);
      setSelectedKeys((prev) => {
        const next = new Set(prev);
        capped.forEach((item, i) => {
          if (resp.results[i]?.ok) next.delete(classifiedRowKey(item));
        });
        return next;
      });
      const failLines = resp.results
        .map((r, i) => (!r.ok ? `${r.jid || `#${i + 1}`}: ${r.error ?? "error"}` : null))
        .filter((x): x is string => Boolean(x));
      let summary =
        resp.failed === 0
          ? `Sent to ${resp.sent} recipient(s).`
          : `Sent ${resp.sent}, failed ${resp.failed}. ${failLines.slice(0, 3).join("; ")}${failLines.length > 3 ? "…" : ""}`;
      if (ordered.length > 25) {
        summary += ` Only the first 25 of ${ordered.length} selected were sent.`;
      }
      setBulkSummary(summary);
    } catch (e) {
      setBulkSummary(e instanceof Error ? e.message : "Bulk send failed");
    } finally {
      setBulkSending(false);
    }
  }, [bulkMessage, selectedKeys, items, conn]);

  const selectedCount = selectedKeys.size;
  const bulkOverCap = selectedCount > 25;

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-void text-foreground">
      <header className="shrink-0 border-b border-card-border/80 bg-forest/95 px-3 py-3 backdrop-blur-md sm:px-5">
        <div className="mx-auto flex max-w-[min(100%,1400px)] flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-3">
            <Link
              href="/"
              className="inline-flex h-7 shrink-0 items-center gap-2 rounded-lg border border-card-border bg-dark-forest/60 px-2.5 text-[0.8rem] font-medium text-white transition hover:bg-white/10"
            >
              <ArrowLeft className="h-3.5 w-3.5" aria-hidden />
              Inbox
            </Link>
            <div className="flex min-w-0 items-center gap-2">
              <LayoutList className="h-5 w-5 shrink-0 text-neon-green" aria-hidden />
              <div className="min-w-0">
                <h1 className="font-display truncate text-lg font-semibold text-white">Classified messages</h1>
                <p className="flex items-center gap-1 text-[11px] text-muted-text">
                  <Radio className="h-3 w-3 animate-pulse text-neon-green/80" aria-hidden />
                  Live · rule-based extraction
                </p>
              </div>
            </div>
          </div>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              void loadFacets();
              if (filtersReady) void loadItems();
            }}
            disabled={loading || !filtersReady}
            aria-busy={loading}
            className={cn(
              "h-8 gap-2 border border-card-border/90 bg-dark-forest/70 px-3 text-white shadow-none",
              "hover:border-neon-green/45 hover:bg-dark-forest/95 hover:text-neon-green",
              "focus-visible:border-neon-green/50",
              "disabled:hover:border-card-border/90 disabled:hover:bg-dark-forest/70 disabled:hover:text-white",
            )}
          >
            <RefreshCw
              className={cn("h-3.5 w-3.5 text-neon-green/90", loading && "animate-spin")}
              aria-hidden
            />
            Refresh
          </Button>
        </div>
      </header>

      <div className="mx-auto flex min-h-0 w-full max-w-[min(100%,1400px)] flex-1 flex-col gap-4 px-3 py-4 sm:px-5">
        <div
          className={`flex flex-wrap gap-2 rounded-2xl border border-card-border/80 bg-dark-forest/40 p-3 shadow-card ${!filtersReady ? "pointer-events-none opacity-60" : ""}`}
          aria-busy={!filtersReady}
        >
          <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[11px] font-medium text-muted-text">
            Match
            <select
              className="rounded-lg border border-card-border bg-void px-2 py-2 text-sm text-white"
              value={match}
              disabled={!filtersReady}
              onChange={(e) => setMatch(e.target.value)}
            >
              <option value="">Any</option>
              {(facets?.matches ?? []).map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <label className="flex min-w-[120px] flex-col gap-1 text-[11px] font-medium text-muted-text">
            Intent
            <select
              className="rounded-lg border border-card-border bg-void px-2 py-2 text-sm text-white"
              value={intent}
              disabled={!filtersReady}
              onChange={(e) => setIntent(e.target.value)}
            >
              <option value="">Any</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="flex min-w-[160px] flex-[2] flex-col gap-1 text-[11px] font-medium text-muted-text">
            Block / message contains
            <input
              type="search"
              placeholder="Blocks or message text"
              className="rounded-lg border border-card-border bg-void px-2 py-2 text-sm text-white placeholder:text-muted-text"
              value={block}
              disabled={!filtersReady}
              onChange={(e) => setBlock(e.target.value)}
            />
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[11px] font-medium text-muted-text">
            Sender name / phone
            <input
              type="search"
              className="rounded-lg border border-card-border bg-void px-2 py-2 text-sm text-white placeholder:text-muted-text"
              value={senderQuery}
              disabled={!filtersReady}
              onChange={(e) => setSenderQuery(e.target.value)}
              placeholder="Name or digits (spaces ok)"
            />
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[11px] font-medium text-muted-text">
            Group name
            <input
              type="search"
              className="rounded-lg border border-card-border bg-void px-2 py-2 text-sm text-white placeholder:text-muted-text"
              value={groupQuery}
              disabled={!filtersReady}
              onChange={(e) => setGroupQuery(e.target.value)}
              placeholder="Search group name"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-white">
            <input
              type="checkbox"
              checked={onlyIncoming}
              disabled={!filtersReady}
              onChange={(e) => setOnlyIncoming(e.target.checked)}
              className="rounded border-card-border"
            />
            Incoming only
          </label>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-white">
            <input
              type="checkbox"
              checked={watchedMatchesOnly}
              disabled={!filtersReady}
              onChange={(e) => setWatchedMatchesOnly(e.target.checked)}
              className="rounded border-card-border"
            />
            Only configured matches
          </label>
        </div>

        {selectedCount > 0 ? (
          <div className="sticky top-0 z-30 shrink-0 rounded-2xl border border-neon-green/35 bg-forest/95 p-3 shadow-card backdrop-blur-md sm:p-4">
            <div className="flex flex-wrap items-center justify-between gap-3 gap-y-2">
              <div className="flex min-w-0 flex-wrap items-center gap-2 sm:gap-3">
                <span
                  className="inline-flex items-center gap-2 rounded-full border border-neon-green/35 bg-neon-green/10 px-3 py-1.5 text-[13px] font-semibold tabular-nums text-white shadow-[inset_0_1px_0_0_rgba(255,255,255,0.06)] ring-1 ring-neon-green/20"
                  title={`${selectedCount} conversation(s) selected`}
                >
                  <CheckSquare className="h-4 w-4 shrink-0 text-neon-green" aria-hidden />
                  <span className="text-white">{selectedCount}</span>
                  <span className="text-[11px] font-semibold uppercase tracking-wide text-white/75">
                    selected
                  </span>
                </span>
                {bulkOverCap ? (
                  <span className="text-[11px] font-medium text-amber-200/90">Max 25 per send</span>
                ) : null}
              </div>
              <div className="flex w-full flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={clearBulkSelection}
                  disabled={bulkSending}
                  className={cn(
                    "h-8 gap-2 border border-card-border/90 bg-dark-forest/70 px-3 text-white shadow-none",
                    "hover:border-white/25 hover:bg-dark-forest/95 hover:text-white",
                    "focus-visible:border-neon-green/45",
                    "disabled:hover:border-card-border/90 disabled:hover:bg-dark-forest/70",
                  )}
                >
                  <Eraser className="h-3.5 w-3.5 shrink-0 text-zinc-300" aria-hidden />
                  Clear
                </Button>
                <Button
                  type="button"
                  variant="secondary"
                  size="sm"
                  onClick={() => void sendBulkDms()}
                  aria-busy={bulkSending}
                  disabled={
                    bulkSending || conn !== "open" || !bulkMessage.trim() || selectedCount === 0
                  }
                  className={cn(
                    "h-8 gap-2 border border-neon-green/45 bg-neon-green/15 px-3 text-neon-green shadow-none",
                    "hover:border-neon-green/70 hover:bg-neon-green/25 hover:text-white",
                    "focus-visible:border-neon-green/60 focus-visible:ring-2 focus-visible:ring-neon-green/35",
                    "disabled:border-card-border/90 disabled:bg-dark-forest/70 disabled:text-white/60 disabled:hover:border-card-border/90 disabled:hover:bg-dark-forest/70 disabled:hover:text-white/60",
                  )}
                >
                  <Send className="h-3.5 w-3.5 shrink-0" aria-hidden />
                  Send to {Math.min(selectedCount, 25)}
                </Button>
              </div>
            </div>

            <div className="my-3 border-t border-white/10" aria-hidden />

            <AccountSelector
              selectedAccountId={bulkAccountId}
              onSelect={setBulkAccountId}
              hideIfSingle
              className="mb-2"
            />
            <textarea
              value={bulkMessage}
              onChange={(e) => setBulkMessage(e.target.value)}
              placeholder="Message to send to each selected DM…"
              rows={3}
              disabled={bulkSending || conn !== "open"}
              className={cn(
                "mb-2 w-full resize-y rounded-xl border border-card-border bg-void px-3 py-2.5 text-sm leading-relaxed text-white",
                "min-h-[5.5rem] max-h-48 overflow-y-auto",
                "placeholder:text-muted-text/65",
                "focus-visible:border-neon-green/45 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-green/35",
              )}
            />
            {conn !== "open" ? (
              <p className="text-xs text-amber-200/90">Connect WhatsApp (status: {conn}) to send.</p>
            ) : null}
            <div aria-live="polite" aria-atomic="true" className="min-h-[1.25rem]">
              {bulkSummary ? (
                <p className="text-xs text-zinc-200/90" role="status">
                  {bulkSummary}
                </p>
              ) : null}
            </div>
          </div>
        ) : null}

        {err && (
          <div className="rounded-xl border border-red-500/35 bg-red-950/40 px-3 py-2 text-sm text-red-100">{err}</div>
        )}

        <div
          className={cn(
            "grid min-h-0 flex-1 gap-4",
            inlineJid ? "grid-cols-1 sm:grid-cols-[minmax(0,1fr)_minmax(280px,46%)]" : "grid-cols-1",
          )}
        >
          <div
            className={cn(
              "flex min-h-0 flex-col",
              inlineJid && mobileShowChat && "max-sm:hidden",
            )}
          >
            <ScrollArea className="min-h-0 flex-1 scrollbar-thin">
              <div className="space-y-3 pb-8">
                {!filtersReady || (loading && items.length === 0) ? (
                  <p className="py-12 text-center text-sm text-muted-text">Loading…</p>
                ) : items.length === 0 ? (
                  <p className="py-12 text-center text-sm text-muted-text">
                    No classified rows yet. Connect WhatsApp and receive messages.
                  </p>
                ) : (
                  items.map((item) => {
                    const isGroupCard =
                      item.remoteJid.endsWith("@g.us") && Boolean(item.senderParticipant?.trim());
                    const displayTitle = classifiedCardDisplayTitle(item);
                    const subtitleSecondary = classifiedCardSubtitleLine(item, displayTitle);
                    const groupThreadHref =
                      item.remoteJid.endsWith("@g.us") && item.groupName?.trim()
                        ? `/?jid=${encodeURIComponent(item.remoteJid)}`
                        : null;
                    const listTitle = safeClassifiedCardListTitle(
                      displayTitle,
                      subtitleSecondary,
                      item.groupName,
                    );
                    const rowKey = classifiedRowKey(item);
                    const isSelected = selectedKeys.has(rowKey);
                    return (
                      <div
                        key={rowKey}
                        className="group relative w-full overflow-hidden rounded-2xl border border-card-border/80 bg-gradient-to-br from-dark-forest/80 to-deep-teal/40 shadow-card transition hover:border-neon-green/35 hover:ring-1 hover:ring-neon-green/20"
                      >
                        <button
                          type="button"
                          onClick={() => openInlineChat(item)}
                          className="absolute inset-0 z-0 rounded-2xl focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-green/50"
                          aria-label={
                            isGroupCard
                              ? `Reply privately to ${displayTitle}`
                              : `Open chat with ${displayTitle}`
                          }
                        />
                        <div className="pointer-events-none absolute left-3 top-3 z-20 flex items-start">
                          <label className="pointer-events-auto flex cursor-pointer items-center gap-0 rounded-md bg-void/80 p-0.5 ring-1 ring-card-border/80 has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-neon-green/45">
                            <input
                              type="checkbox"
                              checked={isSelected}
                              onChange={() => toggleSelectedKey(rowKey)}
                              onClick={(e) => e.stopPropagation()}
                              className="size-4 shrink-0 cursor-pointer appearance-auto rounded border border-card-border bg-void accent-neon-green focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-green/55 focus-visible:ring-offset-0"
                              aria-label={`Select ${displayTitle}`}
                            />
                          </label>
                        </div>
                        <article className="relative z-10 w-full p-4 pl-11 pt-4 pointer-events-none">
                          <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                            <div className="min-w-0">
                              <p className="truncate text-sm font-semibold text-white">{displayTitle}</p>
                              <p
                                className="truncate text-[11px] text-muted-text"
                                title={listTitle}
                              >
                                {subtitleSecondary ? (
                                  <span>{subtitleSecondary}</span>
                                ) : isLidWhatsAppJid(item.senderParticipant) ? (
                                  <span className="text-muted-text/80">WhatsApp contact</span>
                                ) : null}
                                {groupThreadHref && item.groupName?.trim() ? (
                                  <span>
                                    {(subtitleSecondary ||
                                      isLidWhatsAppJid(item.senderParticipant)) && (
                                      <span aria-hidden> · </span>
                                    )}
                                    <Link
                                      href={groupThreadHref}
                                      onClick={(e) => e.stopPropagation()}
                                      className="pointer-events-auto font-medium text-neon-green/80 underline-offset-2 hover:text-neon-green hover:underline"
                                    >
                                      {item.groupName.trim()}
                                    </Link>
                                  </span>
                                ) : item.groupName?.trim() ? (
                                  <span>
                                    {" "}
                                    ·{" "}
                                    <span className="text-neon-green/80">{item.groupName.trim()}</span>
                                  </span>
                                ) : null}
                              </p>
                            </div>
                            <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                              {item.intent !== "none" && (
                                <span className="rounded-md bg-amber-500/15 px-2 py-0.5 text-[10px] font-medium uppercase text-amber-200 ring-1 ring-amber-500/25">
                                  {item.intent}
                                </span>
                              )}
                              {item.matchedMatch && (
                                <span
                                  className="max-w-[10rem] truncate rounded-md bg-neon-green/10 px-2 py-0.5 text-[10px] font-medium text-neon-green ring-1 ring-neon-green/20"
                                  title={item.matchedMatch}
                                >
                                  {item.matchedMatch}
                                </span>
                              )}
                              {item.matchedMatch && !Boolean(item.isConfiguredMatch) && (
                                <span className="rounded-md bg-zinc-500/20 px-2 py-0.5 text-[10px] font-medium text-zinc-300 ring-1 ring-white/10">
                                  auto-detected
                                </span>
                              )}
                              <span className="text-[10px] text-muted-text">
                                {fmtTime(item.messageTimestampMs)}
                              </span>
                            </div>
                          </div>

                          <div className="mb-2 flex flex-wrap gap-1">
                            {item.quantity != null && (
                              <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-200 ring-1 ring-white/10">
                                qty {item.quantity}
                              </span>
                            )}
                            {item.matchDate && (
                              <span className="rounded-md bg-white/5 px-1.5 py-0.5 text-[10px] text-zinc-200 ring-1 ring-white/10">
                                {item.matchDate}
                              </span>
                            )}
                            {item.sequenceRequired === true && (
                              <span className="rounded-md bg-violet-500/15 px-1.5 py-0.5 text-[10px] text-violet-200 ring-1 ring-violet-500/25">
                                sequence
                              </span>
                            )}
                            {item.sequenceRequired === false && (
                              <span className="rounded-md bg-zinc-600/30 px-1.5 py-0.5 text-[10px] text-zinc-300 ring-1 ring-white/10">
                                non-seq
                              </span>
                            )}
                            {(item.blocks ?? []).slice(0, 6).map((b) => (
                              <span
                                key={b}
                                className="max-w-[10rem] truncate rounded-md bg-teal-500/10 px-1.5 py-0.5 text-[10px] text-teal-100 ring-1 ring-teal-500/20"
                                title={b}
                              >
                                {b}
                              </span>
                            ))}
                            {(item.seats ?? []).slice(0, 8).map((s) => (
                              <span
                                key={s}
                                className="rounded-md bg-sky-500/10 px-1.5 py-0.5 font-mono text-[10px] text-sky-100 ring-1 ring-sky-500/20"
                              >
                                {s}
                              </span>
                            ))}
                          </div>

                          {(item.priceHints?.length ?? 0) > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1">
                              {item.priceHints!.map((p) => (
                                <span key={p} className="text-[10px] text-amber-100/90">
                                  {p}
                                </span>
                              ))}
                            </div>
                          )}

                          {(item.extraInfo?.length ?? 0) > 0 && (
                            <div className="mb-2 flex flex-wrap gap-1">
                              {item.extraInfo!.map((x) => (
                                <span
                                  key={x}
                                  className="rounded-md bg-neon-green/5 px-1.5 py-0.5 text-[10px] text-neon-green/90 ring-1 ring-neon-green/15"
                                >
                                  {x}
                                </span>
                              ))}
                            </div>
                          )}

                          <p className="whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
                            {item.body?.trim() || item.rawSnippet || "—"}
                          </p>
                        </article>
                      </div>
                    );
                  })
                )}
              </div>
            </ScrollArea>
          </div>

          {inlineJid ? (
            <div
              className={cn(
                "flex min-h-0 flex-1 flex-col overflow-hidden",
                !mobileShowChat && "max-sm:hidden",
              )}
            >
              <ConversationView
                jid={inlineJid}
                chat={inlineChat}
                conn={conn}
                onBack={closeInlineChat}
                alwaysShowBackButton
                backAriaLabel="Back to classified list"
                privateReplyQuote={privateReplyQuote}
                onPrivateReplyQuoteConsumed={() => setPrivateReplyQuote(null)}
              />
            </div>
          ) : null}
        </div>
      </div>
    </div>
  );
}
