"use client";

import { useMemo, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import type { ChatRow, InboxTab } from "@/lib/types";
import { chatListTitle } from "@/lib/chat-list-display";
import { ChatAvatar } from "@/components/ChatAvatar";
import { Inbox, Search } from "lucide-react";

type Props = {
  chats: ChatRow[];
  inboxTab: InboxTab;
  onInboxTabChange: (tab: InboxTab) => void;
  /** Distinct personal recipients who received an auto-reply today (local calendar day); null before first load. */
  autoReplyUniqueToday: number | null;
  selectedJid: string | null;
  onSelect: (jid: string) => void;
  isLoading: boolean;
  className?: string;
};

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function fmtListTime(iso: string | null): string {
  if (!iso) return "—";
  const d = new Date(iso);
  const now = new Date();
  const startToday = startOfLocalDay(now);
  const msgDay = startOfLocalDay(d);
  if (msgDay === startToday) {
    return d.toLocaleTimeString(undefined, { hour: "2-digit", minute: "2-digit" });
  }
  const yest = new Date(now);
  yest.setDate(yest.getDate() - 1);
  if (msgDay === startOfLocalDay(yest)) return "Yesterday";
  const weekAgo = startToday - 6 * 86_400_000;
  if (msgDay >= weekAgo) {
    return d.toLocaleDateString(undefined, { weekday: "short" });
  }
  return d.toLocaleDateString(undefined, { day: "2-digit", month: "2-digit", year: "numeric" });
}

function previewLine(c: ChatRow): string {
  const body =
    c.lastMessageBody?.trim() ||
    (c.lastMessageType ? `(${c.lastMessageType})` : "") ||
    "";
  if (c.isGroup && c.lastSenderName?.trim() && c.lastMessageFromMe === false) {
    return `${c.lastSenderName.trim()}: ${body}`;
  }
  if (c.lastMessageFromMe === true) {
    return body ? `You: ${body}` : "You";
  }
  return body || " ";
}

function UnreadBadge({ count }: { count: number }) {
  if (count > 0) {
    return (
      <span className="min-w-[1.25rem] rounded-full bg-neon-green px-1.5 py-0.5 text-center text-[10px] font-bold text-void">
        {count > 99 ? "99+" : count}
      </span>
    );
  }
  return null;
}

export function ChatList({
  chats,
  inboxTab,
  onInboxTabChange,
  autoReplyUniqueToday,
  selectedJid,
  onSelect,
  isLoading,
  className,
}: Props) {
  const [q, setQ] = useState("");

  const filtered = useMemo(() => {
    const t = q.trim().toLowerCase();
    if (!t) return chats;
    return chats.filter((c) => {
      const title = chatListTitle(c).toLowerCase();
      return (
        c.jid.toLowerCase().includes(t) ||
        (c.name?.toLowerCase().includes(t) ?? false) ||
        title.includes(t)
      );
    });
  }, [chats, q]);

  const emptyMessage = (() => {
    if (isLoading) return null;
    if (q.trim()) return "No chats match your search.";
    if (inboxTab === "autoReply") return "No conversations with an auto-reply yet.";
    return "No chats yet.";
  })();

  return (
    <div className={cn("flex min-h-0 flex-1 flex-col", className)}>
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Inbox className="h-4 w-4 text-neon-green/80" aria-hidden />
          <h2 className="text-xs font-semibold uppercase tracking-[0.16em] text-muted-text">Chats</h2>
        </div>
      </div>

      <div
        className="mb-3 flex rounded-full border border-card-border/80 bg-deep-teal/50 p-0.5"
        role="tablist"
        aria-label="Inbox scope"
      >
        <button
          type="button"
          role="tab"
          aria-selected={inboxTab === "all"}
          onClick={() => onInboxTabChange("all")}
          className={cn(
            "min-h-9 flex-1 rounded-full px-2 text-xs font-medium transition",
            inboxTab === "all"
              ? "bg-forest/95 text-white shadow-sm ring-1 ring-neon-green/25"
              : "text-muted-text hover:text-white/90",
          )}
        >
          All
        </button>
        <button
          type="button"
          role="tab"
          aria-selected={inboxTab === "autoReply"}
          onClick={() => onInboxTabChange("autoReply")}
          aria-label={
            autoReplyUniqueToday === null
              ? "Auto-reply chats"
              : `Auto-reply chats, ${autoReplyUniqueToday} unique recipients today`
          }
          className={cn(
            "min-h-9 flex-1 rounded-full px-2 text-xs font-medium transition",
            inboxTab === "autoReply"
              ? "bg-forest/95 text-white shadow-sm ring-1 ring-neon-green/25"
              : "text-muted-text hover:text-white/90",
          )}
        >
          <span className="flex min-w-0 items-center justify-center gap-1">
            <span className="truncate">Auto-reply</span>
            {autoReplyUniqueToday != null && Number.isFinite(autoReplyUniqueToday) && (
              <span className="shrink-0 tabular-nums text-[10px] font-semibold opacity-90">
                ({autoReplyUniqueToday})
              </span>
            )}
          </span>
        </button>
      </div>

      <div className="relative mb-2">
        <Search
          className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-text"
          aria-hidden
        />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Search"
          className="h-10 w-full rounded-full border border-card-border/80 bg-deep-teal/60 py-2 pl-9 pr-3 text-sm text-white placeholder:text-muted-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-green"
          aria-label="Search chats"
        />
      </div>

      <ScrollArea className="min-h-[10rem] flex-1 rounded-xl border border-card-border/60 bg-deep-teal/50 sm:min-h-0">
        {isLoading ? (
          <div className="flex flex-col gap-2 p-3">
            {[0, 1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-14 animate-pulse rounded-xl bg-shade-70/15"
                style={{ animationDelay: `${i * 80}ms` }}
              />
            ))}
          </div>
        ) : (
          <div className="flex flex-col gap-0.5 p-1.5">
            {filtered.length === 0 ? (
              <p className="px-3 py-8 text-center text-sm text-muted-text">{emptyMessage}</p>
            ) : (
              filtered.map((c) => {
                const label = chatListTitle(c);
                const prev = previewLine(c);
                return (
                  <button
                    type="button"
                    key={c.jid}
                    onClick={() => onSelect(c.jid)}
                    className={cn(
                      "flex w-full items-center gap-2.5 rounded-xl px-2.5 py-2.5 text-left transition",
                      selectedJid === c.jid
                        ? "border-l-2 border-l-neon-green bg-forest/90 ring-1 ring-neon-green/35"
                        : "border-l-2 border-l-transparent hover:bg-white/5",
                    )}
                  >
                    <ChatAvatar jid={c.jid} label={label} size="sm" className="sm:h-10 sm:w-10 sm:text-xs" />
                    <div className="min-w-0 flex-1">
                      <div className="flex items-center justify-between gap-2">
                        <span className="truncate text-sm font-medium text-white" title={`${label}\n${c.jid}`}>
                          {label}
                        </span>
                        <div className="flex shrink-0 items-center gap-1.5">
                          <span className="text-[11px] text-muted-text">{fmtListTime(c.lastMessageAt)}</span>
                          <UnreadBadge count={c.unreadCount} />
                        </div>
                      </div>
                      <p className="mt-0.5 truncate text-[12px] text-muted-text">{prev}</p>
                    </div>
                  </button>
                );
              })
            )}
          </div>
        )}
      </ScrollArea>
    </div>
  );
}
