"use client";

import Link from "next/link";
import { LayoutList, Loader2, Settings2, X } from "lucide-react";
import { ConnectionBadge } from "@/components/ConnectionBadge";
import type { ConnectionState } from "@/lib/types";

interface TopNavProps {
  conn: ConnectionState;
  busy: boolean;
  onOpenConnection: () => void;
  onOpenSettings: () => void;
  autoReplyNote: string | null;
  onDismissAutoReply: () => void;
  sessionError: string | null;
  onDismissSessionError: () => void;
}

export function TopNav({
  conn,
  busy,
  onOpenConnection,
  onOpenSettings,
  autoReplyNote,
  onDismissAutoReply,
  sessionError,
  onDismissSessionError,
}: TopNavProps) {
  return (
    <header className="sticky top-0 z-50 shrink-0 border-b border-card-border/80 bg-forest/95 pt-[env(safe-area-inset-top,0px)] backdrop-blur-md">
      <div className="mx-auto flex h-14 max-w-[1600px] items-center justify-between gap-2 px-3 sm:h-16 sm:px-5">
        <div className="flex min-w-0 items-center gap-3">
          <div
            className="hidden h-9 w-9 shrink-0 rounded-xl border border-neon-green/30 bg-neon-green/10 sm:flex sm:items-center sm:justify-center"
            aria-hidden
          >
            <span className="font-display text-sm font-bold text-neon-green">W</span>
          </div>
          <div className="min-w-0">
            <span className="font-display block truncate text-base font-bold tracking-tight text-white sm:text-lg">
              WA Desk
            </span>
            <span className="hidden text-[11px] text-muted-text sm:block">
              Live inbox · auto-reply
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-1.5 sm:gap-2">
          <button
            type="button"
            onClick={onOpenConnection}
            disabled={busy}
            className="inline-flex min-h-[44px] min-w-[44px] items-center gap-2 rounded-full border border-card-border bg-dark-forest/80 px-3 py-1.5 text-left transition hover:bg-white/10 disabled:opacity-45 sm:px-3.5"
            aria-label="Session and QR code"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 shrink-0 animate-spin text-neon-green" aria-hidden />
            ) : null}
            <ConnectionBadge state={conn} />
          </button>

          <Link
            href="/classified"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
            aria-label="Classified messages"
            title="Classified messages"
          >
            <LayoutList className="h-5 w-5" />
          </Link>

          <button
            type="button"
            onClick={onOpenSettings}
            aria-label="Settings"
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-white/90 transition hover:bg-white/10"
          >
            <Settings2 className="h-5 w-5" />
          </button>
        </div>
      </div>

      {(sessionError || autoReplyNote) && (
        <div className="mx-auto max-w-[1600px] space-y-2 px-3 pb-2 sm:px-5">
          {sessionError && (
            <div
              role="alert"
              className="flex items-start justify-between gap-2 rounded-xl border border-red-500/35 bg-red-950/40 px-3 py-2.5 text-sm text-red-100"
            >
              <span className="min-w-0 break-words">{sessionError}</span>
              <button
                type="button"
                onClick={onDismissSessionError}
                className="shrink-0 rounded-full p-1 hover:bg-red-500/20"
                aria-label="Dismiss error"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
          {autoReplyNote && (
            <div className="flex items-start justify-between gap-2 rounded-xl border border-neon-green/25 bg-neon-green/10 px-3 py-2.5 text-sm text-neon-green">
              <span className="min-w-0">{autoReplyNote}</span>
              <button
                type="button"
                onClick={onDismissAutoReply}
                className="shrink-0 rounded-full p-1 hover:bg-neon-green/15"
                aria-label="Dismiss"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          )}
        </div>
      )}
    </header>
  );
}
