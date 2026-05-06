"use client";

import type { ConnectionState } from "@/lib/types";
import { cn } from "@/lib/utils";

type Props = {
  state: ConnectionState;
};

const labels: Record<string, string> = {
  idle: "Idle",
  connecting: "Connecting",
  open: "Connected",
  close: "Disconnected",
};

const dotClasses: Record<string, string> = {
  idle: "bg-shade-50",
  connecting: "bg-amber-400 animate-pulse",
  open: "bg-neon-green shadow-[0_0_8px_rgba(54,244,164,0.7)]",
  close: "bg-red-500",
};

export function ConnectionBadge({ state }: Props) {
  const k = String(state);
  const dotClass = Object.hasOwn(dotClasses, k) ? dotClasses[k]! : "bg-shade-50";
  const label = Object.hasOwn(labels, k) ? labels[k]! : k;

  return (
    <span
      className={cn(
        "inline-flex max-w-[9.5rem] items-center gap-2 rounded-full border px-2.5 py-1 text-xs font-medium sm:max-w-none sm:px-3 sm:text-sm",
        k === "connecting" &&
          "border-amber-500/40 bg-amber-500/15 text-amber-100",
        k === "open" && "border-neon-green/35 bg-neon-green/10 text-white",
        k === "idle" && "border-card-border bg-dark-forest/80 text-muted-text",
        k === "close" && "border-red-500/30 bg-red-950/30 text-red-100",
        !["connecting", "open", "idle", "close"].includes(k) &&
          "border-card-border bg-dark-forest text-muted-text",
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass)} />
      <span className="truncate">{label}</span>
    </span>
  );
}
