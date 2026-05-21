"use client";

import { X } from "lucide-react";
import { cn } from "@/lib/utils";
import { SettingsPanel } from "@/components/SettingsPanel";
import { AccountsManager } from "@/components/AccountsManager";

interface SettingsDrawerProps {
  open: boolean;
  onClose: () => void;
}

export function SettingsDrawer({ open, onClose }: SettingsDrawerProps) {
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
          "bottom-0 left-0 right-0 max-h-[92dvh] rounded-t-2xl border-t border-card-border lg:bottom-0 lg:left-auto lg:right-0 lg:top-0 lg:max-h-none lg:h-full lg:w-[min(100vw,520px)] lg:rounded-none lg:border-l lg:border-t-0",
          open
            ? "pointer-events-auto translate-y-0 lg:translate-x-0"
            : "pointer-events-none translate-y-[105%] lg:translate-y-0 lg:translate-x-full",
        )}
        role="dialog"
        aria-modal="true"
        aria-label="Settings"
      >
        <div className="flex shrink-0 items-center justify-between border-b border-card-border/80 px-4 py-3 sm:px-5">
          <div>
            <h2 className="font-display text-lg font-semibold text-white">Auto-reply</h2>
            <p className="text-xs text-muted-text">Matches, cooldown, exclusions</p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-11 w-11 items-center justify-center rounded-full text-muted-text transition hover:bg-white/10 hover:text-white"
            aria-label="Close settings"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 py-4 sm:px-5 scrollbar-thin space-y-5">
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-text">Accounts</h3>
            <AccountsManager />
          </section>
          <section>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted-text">Auto-reply</h3>
            <SettingsPanel />
          </section>
        </div>
      </div>
    </>
  );
}
