"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import { Loader2, MessageCircle } from "lucide-react";
import { TopNav } from "@/components/TopNav";
import { SettingsDrawer } from "@/components/SettingsDrawer";
import { ConnectionDrawer } from "@/components/ConnectionDrawer";
import { ChatList } from "@/components/ChatList";
import { ConversationView } from "@/components/ConversationView";
import { getJson, postJson } from "@/lib/api";
import { getSocket, resetSocket } from "@/lib/socket";
import { useSocketEvent } from "@/lib/use-socket-event";
import type { ChatRow, MessageDto, ConnectionState, InboxTab, SocketEventMap } from "@/lib/types";

type SessionStatus = { status: string };

type ChatsResp = { chats: ChatRow[] };

type AutoReplyThreadsResp = { jids: string[] };

type AutoReplyStatsResp = { uniqueRecipientsToday: number };

function localCalendarDayBoundsMs(): { fromMs: number; toMs: number } {
  const now = new Date();
  const start = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const end = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  return { fromMs: start.getTime(), toMs: end.getTime() };
}

function parseUniqueRecipientsToday(stats: AutoReplyStatsResp): number {
  const v = stats.uniqueRecipientsToday;
  const n = typeof v === "number" ? v : Number.parseInt(String(v ?? ""), 10);
  return Number.isFinite(n) ? n : 0;
}

function msgKey(m: MessageDto) {
  return `${m.remoteJid}|${m.id}|${String(m.fromMe)}`;
}

/** Kept for unit tests; newest-first prepend (legacy dashboard message list). */
export function deduplicateMessages(
  existing: MessageDto[],
  incoming: MessageDto,
): MessageDto[] {
  const key = msgKey(incoming);
  if (existing.some((x) => msgKey(x) === key)) return existing;
  return [incoming, ...existing];
}

/** @deprecated Kept for unit tests — list updates now prefer `mergeChatUpdated` + server `chat:updated`. */
export function updateChatList(chats: ChatRow[], msg: MessageDto): ChatRow[] {
  const idx = chats.findIndex((x) => x.jid === msg.remoteJid);
  const rawBody =
    msg.body != null && String(msg.body).trim().length > 0
      ? String(msg.body).trim()
      : `(${msg.messageType})`;
  const lastMessageBody = rawBody.length > 512 ? `${rawBody.slice(0, 509)}…` : rawBody;
  if (idx < 0) {
    return [
      {
        jid: msg.remoteJid,
        name: msg.pushName,
        isGroup: msg.remoteJid.endsWith("@g.us"),
        lastMessageAt: msg.createdAt,
        unreadCount: msg.fromMe ? 0 : 1,
        updatedAt: new Date().toISOString(),
        lastMessageBody,
        lastMessageType: msg.messageType,
        lastMessageFromMe: msg.fromMe,
        lastSenderName: msg.fromMe ? null : (msg.pushName?.trim() ?? null),
      },
      ...chats,
    ];
  }
  const copy = [...chats];
  const row = copy.splice(idx, 1)[0]!;
  copy.unshift({
    ...row,
    lastMessageAt: msg.createdAt,
    name: row.name ?? msg.pushName,
    unreadCount: msg.fromMe ? row.unreadCount : row.unreadCount + 1,
    lastMessageBody,
    lastMessageType: msg.messageType,
    lastMessageFromMe: msg.fromMe,
    lastSenderName: msg.fromMe ? null : (msg.pushName?.trim() ?? null),
  });
  return copy;
}

export function mergeChatUpdated(chats: ChatRow[], row: ChatRow): ChatRow[] {
  const others = chats.filter((c) => c.jid !== row.jid);
  const merged = [row, ...others];
  merged.sort((a, b) => {
    const ta = a.lastMessageAt ? new Date(a.lastMessageAt).getTime() : 0;
    const tb = b.lastMessageAt ? new Date(b.lastMessageAt).getTime() : 0;
    if (tb !== ta) return tb - ta;
    return b.updatedAt.localeCompare(a.updatedAt);
  });
  return merged;
}

function normalizeChatRow(r: Partial<ChatRow> & { jid: string }): ChatRow {
  return {
    jid: r.jid,
    name: r.name ?? null,
    isGroup: Boolean(r.isGroup ?? r.jid.endsWith("@g.us")),
    lastMessageAt: r.lastMessageAt ?? null,
    unreadCount: r.unreadCount ?? 0,
    updatedAt: r.updatedAt ?? new Date().toISOString(),
    lastMessageBody: r.lastMessageBody ?? null,
    lastMessageType: r.lastMessageType ?? null,
    lastMessageFromMe: r.lastMessageFromMe ?? null,
    lastSenderName: r.lastSenderName ?? null,
  };
}

export function Dashboard() {
  const [conn, setConn] = useState<ConnectionState>("idle");
  const [qr, setQr] = useState<string | null>(null);
  const [chats, setChats] = useState<ChatRow[]>([]);
  const [selectedJid, setSelectedJid] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingChats, setLoadingChats] = useState(true);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [autoReplyNote, setAutoReplyNote] = useState<string | null>(null);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [connectionOpen, setConnectionOpen] = useState(false);
  const [mobileShowFeed, setMobileShowFeed] = useState(false);
  const [inboxTab, setInboxTab] = useState<InboxTab>("all");
  const [autoReplyJidSet, setAutoReplyJidSet] = useState<Set<string>>(() => new Set());
  const [autoReplyUniqueToday, setAutoReplyUniqueToday] = useState<number | null>(null);

  const isOpen = String(conn) === "open";

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 640px)");
    const sync = () => {
      if (mq.matches) setMobileShowFeed(false);
    };
    sync();
    mq.addEventListener("change", sync);
    return () => mq.removeEventListener("change", sync);
  }, []);

  const selectedChat = useMemo(
    () => chats.find((c) => c.jid === selectedJid) ?? null,
    [chats, selectedJid],
  );

  const displayChats = useMemo(
    () => (inboxTab === "all" ? chats : chats.filter((c) => autoReplyJidSet.has(c.jid))),
    [chats, inboxTab, autoReplyJidSet],
  );

  const handleSelectJid = useCallback((jid: string) => {
    setSelectedJid(jid);
    setChats((prev) => prev.map((c) => (c.jid === jid ? { ...c, unreadCount: 0 } : c)));
    if (!window.matchMedia("(min-width: 640px)").matches) {
      setMobileShowFeed(true);
    }
  }, []);

  const handleBackFromConversation = useCallback(() => {
    setMobileShowFeed(false);
    setSelectedJid(null);
  }, []);

  const fetchAutoReplyStats = useCallback(async () => {
    const { fromMs, toMs } = localCalendarDayBoundsMs();
    const q = new URLSearchParams({ fromMs: String(fromMs), toMs: String(toMs) });
    try {
      const s = await getJson<AutoReplyStatsResp>(`/api/auto-replies/stats?${q}`);
      setAutoReplyUniqueToday(parseUniqueRecipientsToday(s));
    } catch {
      // keep prior value
    }
  }, []);

  const refetch = useCallback(async () => {
    setLoadingChats(true);
    try {
      const { fromMs, toMs } = localCalendarDayBoundsMs();
      const statsQ = new URLSearchParams({ fromMs: String(fromMs), toMs: String(toMs) });
      const [c, ar, stats] = await Promise.all([
        getJson<ChatsResp>("/api/chats"),
        getJson<AutoReplyThreadsResp>("/api/chats/auto-reply-threads"),
        getJson<AutoReplyStatsResp>(`/api/auto-replies/stats?${statsQ}`),
      ]);
      setChats(c.chats.map(normalizeChatRow));
      setAutoReplyJidSet(new Set(ar.jids.filter((j) => j.trim().length > 0)));
      setAutoReplyUniqueToday(parseUniqueRecipientsToday(stats));
    } catch {
      // keep existing
    } finally {
      setLoadingChats(false);
    }
  }, []);

  useSocketEvent("qr", (d) => {
    const p = d as { qr: string };
    if (p?.qr) {
      setQr(p.qr);
    }
  });

  useSocketEvent("connection:state", (d) => {
    const p = d as { state: string };
    if (p?.state) {
      setConn(p.state as ConnectionState);
      if (p.state === "open") {
        setQr(null);
        void refetch();
      }
    }
  });

  useSocketEvent("chat:updated", (d) => {
    const row = normalizeChatRow(d as Partial<ChatRow> & { jid: string });
    setChats((prev) => mergeChatUpdated(prev, row));
  });

  useSocketEvent("auto-reply:sent", (d) => {
    const p = d as SocketEventMap["auto-reply:sent"];
    const personalJid = p.counterpartyJid?.trim() ?? "";
    if (personalJid && !personalJid.endsWith("@g.us")) {
      setAutoReplyJidSet((prev) => new Set([...prev, personalJid]));
    }
    if (p.counterpartyJid) {
      const shortJid = p.counterpartyJid.split("@")[0] ?? p.counterpartyJid;
      setAutoReplyNote(`Auto-reply sent to ${shortJid}`);
      setTimeout(() => setAutoReplyNote(null), 5000);
    }
    void fetchAutoReplyStats();
  });

  useEffect(() => {
    void (async () => {
      try {
        const s = await getJson<SessionStatus>("/api/session/status");
        setConn((s.status as ConnectionState) || "idle");
        const { fromMs, toMs } = localCalendarDayBoundsMs();
        const statsQ = new URLSearchParams({ fromMs: String(fromMs), toMs: String(toMs) });
        const [c, ar, stats] = await Promise.all([
          getJson<ChatsResp>("/api/chats"),
          getJson<AutoReplyThreadsResp>("/api/chats/auto-reply-threads"),
          getJson<AutoReplyStatsResp>(`/api/auto-replies/stats?${statsQ}`),
        ]);
        setChats(c.chats.map(normalizeChatRow));
        setAutoReplyJidSet(new Set(ar.jids.filter((j) => j.trim().length > 0)));
        setAutoReplyUniqueToday(parseUniqueRecipientsToday(stats));
      } catch (e) {
        setErr(e instanceof Error ? e.message : "Failed to load");
      } finally {
        setLoading(false);
        setLoadingChats(false);
      }
    })();
  }, []);

  useEffect(() => {
    const id = window.setInterval(() => {
      void fetchAutoReplyStats();
    }, 60_000);
    return () => window.clearInterval(id);
  }, [fetchAutoReplyStats]);

  const start = async () => {
    setBusy(true);
    setErr(null);
    setQr(null);
    try {
      const out = await postJson<{
        ok: boolean;
        state: string;
        error?: string;
      }>("/api/session/start");
      if (out && typeof out === "object" && "ok" in out && !out.ok) {
        setErr(out.error ?? "Start failed");
      }
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Start failed");
    } finally {
      setBusy(false);
    }
  };

  const logout = async () => {
    setBusy(true);
    setErr(null);
    try {
      await postJson("/api/session/logout");
      setChats([]);
      setAutoReplyJidSet(new Set());
      setAutoReplyUniqueToday(null);
      setInboxTab("all");
      setSelectedJid(null);
      setQr(null);
      setConn("close");
      resetSocket();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Logout failed");
    } finally {
      getSocket();
      setBusy(false);
    }
  };

  if (loading) {
    return (
      <div className="flex min-h-dvh flex-col items-center justify-center gap-4 bg-void px-6 text-center">
        <Loader2 className="h-10 w-10 animate-spin text-neon-green" aria-hidden />
        <div>
          <p className="font-display text-lg font-semibold text-white">Loading desk</p>
          <p className="mt-1 text-sm text-muted-text">Syncing session and inbox…</p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex h-dvh max-h-dvh min-h-0 flex-col overflow-hidden bg-void text-foreground">
      <TopNav
        conn={conn}
        busy={busy}
        onOpenConnection={() => setConnectionOpen(true)}
        onOpenSettings={() => setSettingsOpen(true)}
        autoReplyNote={autoReplyNote}
        onDismissAutoReply={() => setAutoReplyNote(null)}
        sessionError={err}
        onDismissSessionError={() => setErr(null)}
      />

      <div className="mx-auto flex min-h-0 w-full max-w-[1600px] flex-1 flex-col px-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-2 sm:px-5 sm:pt-3">
        <main className="mt-6 grid min-h-0 flex-1 grid-cols-1 gap-4 sm:grid-cols-[280px_1fr] sm:gap-6 lg:grid-cols-[320px_1fr]">
          <div
            className={cn(
              "flex min-h-0 flex-col overflow-hidden rounded-2xl border border-card-border/90 bg-dark-forest/40 p-3 shadow-card sm:p-4",
              mobileShowFeed && "max-sm:hidden",
            )}
          >
            <ChatList
              chats={displayChats}
              inboxTab={inboxTab}
              onInboxTabChange={setInboxTab}
              autoReplyUniqueToday={autoReplyUniqueToday}
              selectedJid={selectedJid}
              onSelect={handleSelectJid}
              isLoading={loadingChats}
              className="min-h-0 flex-1"
            />
          </div>

          <div
            className={cn(
              "flex min-h-0 flex-col",
              (!selectedJid || !mobileShowFeed) && "max-sm:hidden",
            )}
          >
            {selectedJid ? (
              <ConversationView
                jid={selectedJid}
                chat={selectedChat}
                conn={conn}
                onBack={handleBackFromConversation}
              />
            ) : (
              <section
                className="flex min-h-0 flex-1 flex-col items-center justify-center gap-3 rounded-2xl border border-card-border/90 bg-gradient-to-b from-dark-forest/40 to-deep-teal/30 p-8 text-center shadow-card"
              >
                <MessageCircle className="h-12 w-12 text-neon-green/50" aria-hidden />
                <div>
                  <p className="font-display text-lg font-semibold text-white">Select a chat</p>
                  <p className="mt-2 max-w-sm text-sm text-muted-text">
                    Pick a conversation from the list. Messages load here with live updates.
                  </p>
                </div>
              </section>
            )}
          </div>
        </main>
      </div>

      <ConnectionDrawer
        open={connectionOpen}
        onClose={() => setConnectionOpen(false)}
        qr={qr}
        connected={isOpen}
        busy={busy}
        onConnect={start}
        onLogout={logout}
        onOpenSettings={() => setSettingsOpen(true)}
      />

      <SettingsDrawer open={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </div>
  );
}
