"use client";

import { useEffect, useState } from "react";
import type { Account } from "@/lib/types";
import { fetchAccounts, statusColor, typeLabel } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { useSocketEvent } from "@/lib/use-socket-event";

export function AccountChips() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    fetchAccounts()
      .then(setAccounts)
      .catch(console.error);
  }, []);

  useSocketEvent("account:updated", (data) => {
    const updated = data as Account;
    setAccounts((prev) => {
      const idx = prev.findIndex((a) => a.id === updated.id);
      if (idx === -1) return [...prev, updated];
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  });

  useSocketEvent("connection:state", (data) => {
    const payload = data as { accountId?: string; state: string };
    if (!payload.accountId) return;
    setAccounts((prev) =>
      prev.map((a) =>
        a.id === payload.accountId
          ? { ...a, status: payload.state as Account["status"] }
          : a,
      ),
    );
  });

  if (accounts.length === 0) return null;

  return (
    <div className="flex flex-wrap items-center gap-2">
      {accounts.map((a) => (
        <AccountChip key={a.id} account={a} />
      ))}
    </div>
  );
}

function AccountChip({ account }: { account: Account }) {
  const dotClass = statusColor(account.status);
  const label = account.displayName || typeLabel(account.type);

  return (
    <span
      title={`${label} — ${account.status}${account.phoneE164 ? ` (${account.phoneE164})` : ""}`}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
        account.status === "open" && "border-neon-green/35 bg-neon-green/10 text-white",
        account.status === "connecting" && "border-amber-500/40 bg-amber-500/15 text-amber-100",
        account.status === "close" && "border-red-500/30 bg-red-950/30 text-red-100",
        account.status === "idle" && "border-card-border bg-dark-forest/80 text-muted-text",
      )}
    >
      <span className={cn("h-2 w-2 shrink-0 rounded-full", dotClass,
        account.status === "connecting" && "animate-pulse",
        account.status === "open" && "shadow-[0_0_6px_rgba(54,244,164,0.7)]",
      )} />
      <span className="max-w-[7rem] truncate">{label}</span>
      <span className="rounded bg-white/10 px-1 text-[10px] uppercase tracking-wide">
        {typeLabel(account.type)}
      </span>
    </span>
  );
}
