"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { ArrowLeft, LayoutList, Radio } from "lucide-react";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { getJson } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useSocketEvent } from "@/lib/use-socket-event";
import type { ClassifiedFacetsDto, ClassifiedMessageDto, SocketEventMap } from "@/lib/types";

type ItemsResp = { items: ClassifiedMessageDto[] };

function shortJid(j: string) {
  if (j.length < 22) return j;
  return `${j.slice(0, 10)}…${j.slice(-8)}`;
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

/** DM / LID JID to open when replying to the sender (group → participant; 1:1 → remote). */
function replyPrivatelyJid(item: ClassifiedMessageDto): string {
  const inGroup = item.remoteJid.endsWith("@g.us");
  const p = item.senderParticipant?.trim();
  if (inGroup && p) return p;
  return item.remoteJid;
}

function matchesFilters(
  item: ClassifiedMessageDto,
  opts: {
    match: string;
    intent: string;
    block: string;
    senderJid: string;
    groupJid: string;
    onlyIncoming: boolean;
    configuredOnly: boolean;
  },
): boolean {
  if (opts.onlyIncoming && item.fromMe) return false;
  if (opts.configuredOnly && !Boolean(item.isConfiguredMatch)) return false;
  if (opts.match && item.matchedMatch !== opts.match) return false;
  if (opts.intent && item.intent !== opts.intent) return false;
  if (opts.block) {
    const hay = (item.blocks ?? []).join(" ").toLowerCase();
    if (!hay.includes(opts.block.toLowerCase())) return false;
  }
  if (opts.senderJid) {
    const sj = opts.senderJid.trim().toLowerCase();
    const p = (item.senderParticipant ?? "").toLowerCase();
    const n = (item.senderPushName ?? "").toLowerCase();
    const userPart = p.includes("@") ? p.split("@")[0]! : p;
    const sjUser = sj.includes("@") ? sj.split("@")[0]! : sj.replace(/^\+/, "");
    if (!p.includes(sj) && !n.includes(sj) && !userPart.includes(sjUser) && !p.includes(sjUser)) {
      return false;
    }
  }
  if (opts.groupJid && item.remoteJid !== opts.groupJid) return false;
  return true;
}

export function ClassifiedBoard() {
  const [facets, setFacets] = useState<ClassifiedFacetsDto | null>(null);
  const [items, setItems] = useState<ClassifiedMessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  const [match, setMatch] = useState("");
  const [intent, setIntent] = useState("");
  const [block, setBlock] = useState("");
  const [senderJid, setSenderJid] = useState("");
  const [groupJid, setGroupJid] = useState("");
  const [onlyIncoming, setOnlyIncoming] = useState(true);
  const [watchedMatchesOnly, setWatchedMatchesOnly] = useState(false);

  const filterOpts = useMemo(
    () => ({
      match,
      intent,
      block,
      senderJid,
      groupJid,
      onlyIncoming,
      configuredOnly: watchedMatchesOnly,
    }),
    [match, intent, block, senderJid, groupJid, onlyIncoming, watchedMatchesOnly],
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
      if (senderJid) q.set("senderJid", senderJid);
      if (groupJid) q.set("groupJid", groupJid);
      q.set("onlyIncoming", onlyIncoming ? "true" : "false");
      if (watchedMatchesOnly) q.set("configuredOnly", "true");
      const r = await getJson<ItemsResp>(`/api/classified-messages?${q.toString()}`);
      setItems(r.items);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Failed to load");
    } finally {
      setLoading(false);
    }
  }, [match, intent, block, senderJid, groupJid, onlyIncoming, watchedMatchesOnly]);

  useEffect(() => {
    void loadFacets();
  }, [loadFacets]);

  useEffect(() => {
    void loadItems();
  }, [loadItems]);

  useEffect(() => {
    getSocket();
  }, []);

  useSocketEvent("message:classified", (d) => {
    const p = d as SocketEventMap["message:classified"];
    if (!p?.messageId) return;
    if (!matchesFilters(p, filterOpts)) return;
    setItems((prev) => {
      const key = `${p.remoteJid}|${p.messageId}|${String(p.fromMe)}`;
      if (prev.some((x) => `${x.remoteJid}|${x.messageId}|${String(x.fromMe)}` === key)) {
        return prev;
      }
      return [p, ...prev].sort((a, b) => Number(b.messageTimestampMs) - Number(a.messageTimestampMs));
    });
  });

  return (
    <div className="flex min-h-dvh flex-col bg-void text-foreground">
      <header className="sticky top-0 z-40 border-b border-card-border/80 bg-forest/95 px-3 py-3 backdrop-blur-md sm:px-5">
        <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3">
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
              void loadItems();
            }}
            disabled={loading}
            className="bg-dark-forest/80"
          >
            Refresh
          </Button>
        </div>
      </header>

      <div className="mx-auto flex w-full max-w-[1200px] flex-1 flex-col gap-4 px-3 py-4 sm:px-5">
        <div className="flex flex-wrap gap-2 rounded-2xl border border-card-border/80 bg-dark-forest/40 p-3 shadow-card">
          <label className="flex min-w-[140px] flex-1 flex-col gap-1 text-[11px] font-medium text-muted-text">
            Match
            <select
              className="rounded-lg border border-card-border bg-void px-2 py-2 text-sm text-white"
              value={match}
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
              onChange={(e) => setIntent(e.target.value)}
            >
              <option value="">Any</option>
              <option value="buy">Buy</option>
              <option value="sell">Sell</option>
              <option value="none">None</option>
            </select>
          </label>
          <label className="flex min-w-[160px] flex-[2] flex-col gap-1 text-[11px] font-medium text-muted-text">
            Block contains
            <input
              type="search"
              placeholder="e.g. west, fanzone"
              className="rounded-lg border border-card-border bg-void px-2 py-2 text-sm text-white placeholder:text-muted-text"
              value={block}
              onChange={(e) => setBlock(e.target.value)}
            />
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[11px] font-medium text-muted-text">
            Sender JID / name
            <input
              type="search"
              className="rounded-lg border border-card-border bg-void px-2 py-2 text-sm text-white placeholder:text-muted-text"
              value={senderJid}
              onChange={(e) => setSenderJid(e.target.value)}
              placeholder="participant or push name"
            />
          </label>
          <label className="flex min-w-[160px] flex-1 flex-col gap-1 text-[11px] font-medium text-muted-text">
            Group JID
            <input
              type="search"
              className="rounded-lg border border-card-border bg-void px-2 py-2 text-sm text-white placeholder:text-muted-text"
              value={groupJid}
              onChange={(e) => setGroupJid(e.target.value)}
              placeholder="@g.us thread"
            />
          </label>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-white">
            <input
              type="checkbox"
              checked={onlyIncoming}
              onChange={(e) => setOnlyIncoming(e.target.checked)}
              className="rounded border-card-border"
            />
            Incoming only
          </label>
          <label className="flex cursor-pointer items-center gap-2 self-end pb-2 text-sm text-white">
            <input
              type="checkbox"
              checked={watchedMatchesOnly}
              onChange={(e) => setWatchedMatchesOnly(e.target.checked)}
              className="rounded border-card-border"
            />
            Only my watched matches
          </label>
        </div>

        {err && (
          <div className="rounded-xl border border-red-500/35 bg-red-950/40 px-3 py-2 text-sm text-red-100">{err}</div>
        )}

        <ScrollArea className="min-h-0 flex-1 scrollbar-thin">
          <div className="space-y-3 pb-8">
            {loading && items.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-text">Loading…</p>
            ) : items.length === 0 ? (
              <p className="py-12 text-center text-sm text-muted-text">No classified rows yet. Connect WhatsApp and receive messages.</p>
            ) : (
              items.map((item) => {
                const dmJid = replyPrivatelyJid(item);
                const isGroupCard =
                  item.remoteJid.endsWith("@g.us") && Boolean(item.senderParticipant?.trim());
                const inboxHref = isGroupCard
                  ? `/?${new URLSearchParams({
                      jid: dmJid,
                      quoteRemoteJid: item.remoteJid,
                      quoteMessageId: item.messageId,
                      quoteFromMe: String(item.fromMe),
                    }).toString()}`
                  : `/?jid=${encodeURIComponent(dmJid)}`;
                return (
                <Link
                  key={`${item.remoteJid}|${item.messageId}|${String(item.fromMe)}`}
                  href={inboxHref}
                  className="block rounded-2xl border border-card-border/80 bg-gradient-to-br from-dark-forest/80 to-deep-teal/40 p-4 shadow-card outline-none transition hover:border-neon-green/35 hover:ring-1 hover:ring-neon-green/20 focus-visible:ring-2 focus-visible:ring-neon-green/50"
                  aria-label={
                    isGroupCard
                      ? `Reply privately to ${item.senderPushName?.trim() || shortJid(dmJid)}`
                      : `Open chat with ${item.senderPushName?.trim() || shortJid(dmJid)}`
                  }
                >
                <article>
                  <div className="mb-2 flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-white">
                        {item.senderPushName?.trim() || shortJid(item.senderParticipant ?? "") || "Unknown sender"}
                      </p>
                      <p className="truncate text-[11px] text-muted-text" title={item.senderParticipant ?? ""}>
                        {item.senderParticipant ? shortJid(item.senderParticipant) : null}
                        {item.groupName ? (
                          <span>
                            {" "}
                            · <span className="text-neon-green/80">{item.groupName}</span>
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
                      <span className="text-[10px] text-muted-text">{fmtTime(item.messageTimestampMs)}</span>
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

                  <p className="mb-3 line-clamp-4 whitespace-pre-wrap break-words text-sm leading-relaxed text-zinc-200">
                    {item.body?.trim() || item.rawSnippet || "—"}
                  </p>

                  <span className="inline-flex h-7 items-center rounded-lg border border-neon-green/30 px-2.5 text-[0.8rem] font-medium text-neon-green">
                    {isGroupCard ? "Reply privately" : "Open chat"}
                  </span>
                </article>
                </Link>
              );
              })
            )}
          </div>
        </ScrollArea>
      </div>
    </div>
  );
}
