"use client";

import { cn } from "@/lib/utils";

function hashHue(jid: string): number {
  let h = 0;
  for (let i = 0; i < jid.length; i++) {
    h = jid.charCodeAt(i) + ((h << 5) - h);
  }
  return Math.abs(h) % 360;
}

function initialsFrom(label: string): string {
  const t = label.trim();
  if (!t) return "?";
  const parts = t.split(/\s+/).filter(Boolean);
  if (parts.length >= 2) {
    return (parts[0]!.slice(0, 1) + parts[1]!.slice(0, 1)).toUpperCase();
  }
  return t.slice(0, 2).toUpperCase();
}

type Props = {
  jid: string;
  label: string;
  className?: string;
  size?: "sm" | "md";
};

export function ChatAvatar({ jid, label, className, size = "md" }: Props) {
  const initials = initialsFrom(label);
  const hue = hashHue(jid);
  const dim = size === "sm" ? "h-9 w-9 text-[11px]" : "h-10 w-10 text-xs";

  return (
    <span
      className={cn(
        "flex shrink-0 items-center justify-center rounded-full font-bold text-white shadow-inner ring-1 ring-white/10",
        dim,
        className,
      )}
      style={{ backgroundColor: `hsl(${hue} 42% 32%)` }}
      aria-hidden
    >
      {initials}
    </span>
  );
}
