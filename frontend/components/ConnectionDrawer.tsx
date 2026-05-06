"use client";

import { Loader2, LogOut, Plug, Settings2, X } from "lucide-react";
import { cn } from "@/lib/utils";
import { QRCard } from "@/components/QRCard";
type Props = {
  open: boolean;
  onClose: () => void;
  qr: string | null;
  connected: boolean;
  busy: boolean;
  onConnect: () => void;
  onLogout: () => void;
  onOpenSettings: () => void;
};

export function ConnectionDrawer({
  open,
  onClose,
  qr,
  connected,
  busy,
  onConnect,
  onLogout,
  onOpenSettings,
}: Props) {
  const connectDisabled = connected || busy;

  return (
    <>
      {open && (
        <div
          className="fixed inset-0 z-40 bg-black/70 backdrop-blur-[2px] transition-opacity"
          onClick={onClose}
          aria-hidden="true"
        />
      )}

      <div
        className={cn(
          "fixed z-50 flex flex-col bg-gradient-to-b from-dark-forest to-deep-teal shadow-2xl transition-transform duration-300 ease-out",
          "bottom-0 left-0 right-0 max-h-[92dvh] rounded-t-2xl border-t border-card-border lg:bottom-0 lg:left-auto lg:right-0 lg:top-0 lg:max-h-none lg:h-full lg:w-[min(100vw,420px)] lg:rounded-none lg:border-l lg:border-t-0",
          open
            ? "pointer-events-auto translate-y-0 lg:translate-x-0"
            : "pointer-events-none translate-y-[105%] lg:translate-y-0 lg:translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="WhatsApp session"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-card-border/80 px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Session</h2>
            <p className="text-xs text-muted-text">QR, connect, and logout</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-text transition hover:bg-white/10 hover:text-white"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 scrollbar-thin">
          <div className="overflow-hidden rounded-2xl border border-card-border/90 bg-gradient-to-b from-dark-forest/90 to-deep-teal/80 p-4 shadow-card">
            <p className="mb-3 text-[10px] font-semibold uppercase tracking-[0.2em] text-muted-text">Link device</p>
            <QRCard qr={qr} connected={connected} />
          </div>

          <div className="flex flex-col gap-2 sm:flex-row">
            <button
              type="button"
              onClick={onConnect}
              disabled={connectDisabled}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full bg-white px-4 text-sm font-semibold text-void transition hover:bg-white/90 disabled:pointer-events-none disabled:opacity-45"
            >
              {busy ? <Loader2 className="h-5 w-5 animate-spin" aria-hidden /> : <Plug className="h-4 w-4" aria-hidden />}
              Connect
            </button>
            <button
              type="button"
              onClick={onLogout}
              disabled={busy}
              className="inline-flex h-11 flex-1 items-center justify-center gap-2 rounded-full border border-white/25 bg-white/5 px-4 text-sm font-medium text-white transition hover:bg-white/10 disabled:opacity-45"
            >
              <LogOut className="h-4 w-4" aria-hidden />
              Logout
            </button>
          </div>

          <button
            type="button"
            onClick={() => {
              onClose();
              onOpenSettings();
            }}
            className="flex w-full items-center justify-center gap-2 rounded-full border border-card-border py-3 text-sm font-medium text-white transition hover:bg-white/5"
          >
            <Settings2 className="h-4 w-4 text-neon-green" aria-hidden />
            Auto-reply settings
          </button>
        </div>
      </div>
    </>
  );
}
