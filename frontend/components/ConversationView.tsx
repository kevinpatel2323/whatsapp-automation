"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { getJson, postJson } from "@/lib/api";
import { getSocket } from "@/lib/socket";
import { useSocketEvent } from "@/lib/use-socket-event";
import type { ChatRow, ConnectionState, GroupMessageReplyRef, MessageDto } from "@/lib/types";
import {
  displayLabelAlreadyShowsPhoneDigits,
  formatWhatsAppPhoneJid,
  messageBubbleSenderLabel,
  phoneUserDigitsFromWhatsAppJid,
  shortJidForUi,
} from "@/lib/whatsapp-display";
import { ChatAvatar } from "@/components/ChatAvatar";
import { Composer } from "@/components/Composer";
import { AccountSelector } from "@/components/AccountSelector";
import { TemplatePicker } from "@/components/TemplatePicker";
import { checkWabaWindow } from "@/lib/waba-window";
import type { MessageTemplate } from "@/lib/types";
import { ChevronLeft, Radio, X } from "lucide-react";

type MessagesResp = { messages: MessageDto[] };

function msgKey(m: MessageDto) {
  return `${m.remoteJid}|${m.id}|${String(m.fromMe)}`;
}

function dedupAppendAsc(prev: MessageDto[], incoming: MessageDto): MessageDto[] {
  if (prev.some((x) => msgKey(x) === msgKey(incoming))) return prev;
  return [...prev, incoming].sort((a, b) => {
    const ta = Number(a.messageTimestampMs);
    const tb = Number(b.messageTimestampMs);
    if (ta !== tb) return ta - tb;
    return a.id.localeCompare(b.id);
  });
}

function fmtBody(m: MessageDto) {
  return m.body?.trim() || `(${m.messageType})`;
}

function startOfLocalDay(d: Date): number {
  return new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime();
}

function formatDateDivider(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const yest = new Date(today);
  yest.setDate(yest.getDate() - 1);
  const sd = startOfLocalDay(d);
  if (sd === startOfLocalDay(today)) return "Today";
  if (sd === startOfLocalDay(yest)) return "Yesterday";
  return d.toLocaleDateString(undefined, {
    weekday: "long",
    day: "numeric",
    month: "short",
    year: "numeric",
  });
}

function bubbleTime(ms: number) {
  return new Date(ms).toLocaleTimeString(undefined, {
    hour: "2-digit",
    minute: "2-digit",
  });
}

type Props = {
  jid: string;
  chat: ChatRow | null;
  conn: ConnectionState;
  onBack?: () => void;
  /** When set, show the header back control at `sm` and up (default: mobile-only). */
  alwaysShowBackButton?: boolean;
  /** Accessible label for the back button (default: “Back to chats”). */
  backAriaLabel?: string;
  /** When set, the next send quotes this group/thread message in the DM (WhatsApp “private reply”). */
  privateReplyQuote?: GroupMessageReplyRef | null;
  onPrivateReplyQuoteConsumed?: () => void;
};

export function ConversationView({
  jid,
  chat,
  conn,
  onBack,
  alwaysShowBackButton,
  backAriaLabel,
  privateReplyQuote,
  onPrivateReplyQuoteConsumed,
}: Props) {
  const [items, setItems] = useState<MessageDto[]>([]);
  const [loading, setLoading] = useState(true);
  const [fetchErr, setFetchErr] = useState<string | null>(null);
  const [selectedAccountId, setSelectedAccountId] = useState<string | null>(null);
  const [showTemplatePicker, setShowTemplatePicker] = useState(false);
  const [pendingText, setPendingText] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const isOpen = String(conn) === "open";

  const isGroup = chat?.isGroup ?? jid.endsWith("@g.us");

  const title = useMemo(() => {
    const n = chat?.name?.trim();
    if (n) return n;
    const phone = formatWhatsAppPhoneJid(jid);
    if (phone) return phone;
    const sj = shortJidForUi(jid);
    if (sj) return sj;
    return isGroup ? "Group" : "WhatsApp";
  }, [chat, jid, isGroup]);

  /** Formatted E.164-style number for direct `@s.whatsapp.net` threads (not for `@lid`). */
  const headerPhone = useMemo(() => {
    if (isGroup) return null;
    const fromThread = formatWhatsAppPhoneJid(jid) ?? formatWhatsAppPhoneJid(chat?.jid ?? null);
    if (!fromThread) return null;
    if (title === fromThread) return null;
    const digits = phoneUserDigitsFromWhatsAppJid(jid) ?? phoneUserDigitsFromWhatsAppJid(chat?.jid ?? null);
    if (!digits) return null;
    if (displayLabelAlreadyShowsPhoneDigits(chat?.name, digits)) return null;
    if (displayLabelAlreadyShowsPhoneDigits(title, digits)) return null;
    return fromThread;
  }, [chat?.jid, chat?.name, isGroup, jid, title]);

  const markRead = useCallback(async () => {
    try {
      await postJson(`/api/chats/${encodeURIComponent(jid)}/read`);
    } catch {
      // non-fatal
    }
  }, [jid]);

  useEffect(() => {
    void markRead();
  }, [markRead]);

  useEffect(() => {
    let alive = true;
    setLoading(true);
    setFetchErr(null);
    setItems([]);
    const socket = getSocket();
    socket.emit("join:chat", jid);

    void (async () => {
      try {
        const r = await getJson<MessagesResp>(
          `/api/messages?remoteJid=${encodeURIComponent(jid)}&limit=80`,
        );
        if (!alive) return;
        const asc = [...r.messages].sort(
          (a, b) => Number(a.messageTimestampMs) - Number(b.messageTimestampMs),
        );
        setItems(asc);
      } catch (e) {
        if (!alive) return;
        setFetchErr(e instanceof Error ? e.message : "Failed to load messages");
      } finally {
        if (alive) setLoading(false);
      }
    })();

    return () => {
      alive = false;
      socket.emit("leave:chat", jid);
    };
  }, [jid]);

  useSocketEvent("message:new", (d) => {
    const p = d as MessageDto;
    if (!p?.id || p.remoteJid !== jid) return;
    setItems((prev) => dedupAppendAsc(prev, p));
  });

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [items.length, jid, loading]);

  const sendDirect = async (text: string, templateId?: string, templateParams?: Record<string, string>) => {
    const body: Record<string, unknown> = { jid };
    if (selectedAccountId) body.accountId = selectedAccountId;
    if (templateId) {
      body.templateId = templateId;
      if (templateParams) body.templateParams = templateParams;
    } else {
      body.text = text;
      if (privateReplyQuote) {
        body.quotedGroupMessage = {
          remoteJid: privateReplyQuote.remoteJid,
          messageId: privateReplyQuote.messageId,
          fromMe: privateReplyQuote.fromMe,
        };
      }
    }
    await postJson<{ ok: boolean }>("/api/messages/send", body);
    if (privateReplyQuote) {
      onPrivateReplyQuoteConsumed?.();
    }
  };

  const handleSend = async (text: string) => {
    // For WABA sends, check the 24h window first
    if (selectedAccountId) {
      const accountsResp = await getJson<{ accounts: Array<{ id: string; type: string }> }>("/api/accounts");
      const account = accountsResp.accounts.find((a) => a.id === selectedAccountId);
      if (account?.type === "waba") {
        const inWindow = await checkWabaWindow(selectedAccountId, jid);
        if (!inWindow) {
          setPendingText(text);
          setShowTemplatePicker(true);
          return;
        }
      }
    }
    await sendDirect(text);
  };

  const handleTemplateSelect = async (template: MessageTemplate, params: Record<string, string>) => {
    setShowTemplatePicker(false);
    await sendDirect(pendingText ?? "", template.name, params);
    setPendingText(null);
  };

  return (
    <>
    {showTemplatePicker && selectedAccountId && (
      <TemplatePicker
        accountId={selectedAccountId}
        onSelect={(t, p) => void handleTemplateSelect(t, p)}
        onClose={() => { setShowTemplatePicker(false); setPendingText(null); }}
      />
    )}
    <section
      className={cn(
        "flex min-h-0 flex-1 flex-col overflow-hidden rounded-2xl border border-card-border/90 bg-gradient-to-b from-dark-forest/60 to-deep-teal/50 shadow-card backdrop-blur-sm",
      )}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-card-border/60 px-3 py-3 sm:px-4">
        {onBack && (
          <button
            type="button"
            onClick={onBack}
            className={cn(
              "inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-card-border text-white transition hover:bg-white/10",
              !alwaysShowBackButton && "sm:hidden",
            )}
            aria-label={backAriaLabel ?? "Back to chats"}
          >
            <ChevronLeft className="h-5 w-5" aria-hidden />
          </button>
        )}
        <ChatAvatar jid={jid} label={title} className="hidden sm:flex" />
        <div className="min-w-0 flex-1">
          <h2 className="truncate font-display text-lg font-semibold tracking-tight text-white">{title}</h2>
          {headerPhone ? (
            <p className="truncate text-xs tabular-nums text-zinc-300/90">{headerPhone}</p>
          ) : null}
          <p className="truncate text-xs text-muted-text">
            {isGroup ? "Group" : "Direct"} ·{" "}
            <span className="inline-flex items-center gap-1 text-neon-green/90">
              <Radio className="h-3 w-3 animate-pulse" aria-hidden />
              Live
            </span>
          </p>
        </div>
      </div>

      <ScrollArea className="min-h-0 flex-1 scrollbar-thin">
        <div className="flex flex-col gap-1 px-3 py-3 sm:px-4">
          {loading ? (
            <p className="py-12 text-center text-sm text-muted-text">Loading messages…</p>
          ) : fetchErr ? (
            <p className="py-12 text-center text-sm text-red-300">{fetchErr}</p>
          ) : items.length === 0 ? (
            <p className="py-12 text-center text-sm text-muted-text">No messages yet.</p>
          ) : (
            items.map((m, i) => {
              const prev = items[i - 1];
              const ts = Number(m.messageTimestampMs);
              const prevTs = prev ? Number(prev.messageTimestampMs) : NaN;
              const showDate =
                !prev ||
                startOfLocalDay(new Date(ts)) !== startOfLocalDay(new Date(prevTs));
              const prevSenderKey = prev
                ? `${prev.participant ?? ""}|${prev.pushName ?? ""}`
                : "";
              const curSenderKey = `${m.participant ?? ""}|${m.pushName ?? ""}`;
              const showSender =
                isGroup && !m.fromMe && (!prev || prev.fromMe || prevSenderKey !== curSenderKey);

              const senderLabel = messageBubbleSenderLabel(m);

              return (
                <div key={msgKey(m)}>
                  {showDate && (
                    <div className="my-3 flex justify-center">
                      <span className="rounded-lg bg-white/5 px-3 py-1 text-[11px] font-medium uppercase tracking-wide text-muted-text ring-1 ring-white/10">
                        {formatDateDivider(ts)}
                      </span>
                    </div>
                  )}
                  <div
                    className={cn(
                      "flex w-full flex-col gap-0.5 py-0.5",
                      m.fromMe ? "items-end" : "items-start",
                    )}
                  >
                    {showSender && (
                      <span className="mb-0.5 max-w-[min(100%,22rem)] pl-1 text-[11px] font-medium text-neon-green/90 sm:max-w-[min(100%,28rem)]">
                        {senderLabel}
                      </span>
                    )}
                    <div
                      className={cn(
                        "max-w-[min(100%,22rem)] rounded-2xl px-3.5 py-2.5 text-sm shadow-sm sm:max-w-[min(100%,28rem)]",
                        m.fromMe
                          ? "rounded-br-md bg-forest text-white ring-1 ring-neon-green/25"
                          : "rounded-bl-md border border-card-border bg-dark-forest/90 text-zinc-100",
                      )}
                    >
                      <div className="mb-1 flex flex-wrap items-center justify-end gap-2">
                        <div className="mr-auto flex flex-wrap gap-1">
                          {m.intent && m.intent !== "none" && (
                            <span className="rounded-md bg-amber-500/15 px-1.5 py-0.5 text-[10px] font-medium text-amber-300 ring-1 ring-amber-500/25">
                              {m.intent}
                            </span>
                          )}
                          {m.matchedMatch && (
                            <span
                              className="max-w-[11rem] truncate rounded-md bg-neon-green/10 px-1.5 py-0.5 text-[10px] font-medium text-neon-green ring-1 ring-neon-green/20"
                              title={m.matchedMatch}
                            >
                              {m.matchedMatch}
                            </span>
                          )}
                        </div>
                        <span className="text-[10px] text-muted-text">{bubbleTime(ts)}</span>
                      </div>
                      <p className="whitespace-pre-wrap break-words leading-relaxed">{fmtBody(m)}</p>
                    </div>
                  </div>
                </div>
              );
            })
          )}
          <div ref={endRef} className="h-px shrink-0" aria-hidden />
        </div>
      </ScrollArea>

      {privateReplyQuote ? (
        <div className="flex shrink-0 items-center gap-2 border-t border-card-border/60 bg-neon-green/10 px-3 py-2 text-xs text-neon-green/95 sm:px-4">
          <span className="min-w-0 flex-1 leading-snug">
            Private reply: the group message will be quoted on send (same as configured-match auto-replies).
          </span>
          <button
            type="button"
            onClick={() => onPrivateReplyQuoteConsumed?.()}
            className="inline-flex shrink-0 items-center justify-center rounded-lg border border-neon-green/35 p-1.5 text-neon-green transition hover:bg-neon-green/15"
            aria-label="Send without quoting group message"
          >
            <X className="h-4 w-4" aria-hidden />
          </button>
        </div>
      ) : null}

      <AccountSelector
        selectedAccountId={selectedAccountId}
        onSelect={setSelectedAccountId}
        hideIfSingle
        disableWabaForGroup
        jid={jid}
        className="px-3 pb-1 pt-2"
      />
      <Composer
        disabled={!isOpen}
        onSend={handleSend}
        placeholder={isOpen ? "Message" : "Connect to send messages"}
      />
    </section>
    </>
  );
}
