"use client";

import { useEffect, useState } from "react";
import type { Account } from "@/lib/types";
import { fetchAccounts, typeLabel } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { useSocketEvent } from "@/lib/use-socket-event";

interface Props {
  selectedAccountId: string | null;
  onSelect: (accountId: string) => void;
  /** If true, only show when >1 account is active */
  hideIfSingle?: boolean;
  /** Filter accounts to a specific type */
  filterType?: "baileys" | "waba";
  /** Disable for group JIDs (WABA can't send to groups) */
  disableWabaForGroup?: boolean;
  jid?: string;
  className?: string;
}

export function AccountSelector({
  selectedAccountId,
  onSelect,
  hideIfSingle = true,
  filterType,
  disableWabaForGroup = false,
  jid,
  className,
}: Props) {
  const [accounts, setAccounts] = useState<Account[]>([]);
  useEffect(() => {
    fetchAccounts()
      .then((all) => {
        const active = all.filter((a) => a.isActive && (filterType ? a.type === filterType : true));
        setAccounts(active);
        // Auto-select primary if nothing selected
        if (!selectedAccountId && active.length > 0) {
          onSelect(active[0]!.id);
        }
      })
      .catch(console.error);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useSocketEvent("account:updated", (data) => {
    const updated = data as Account;
    setAccounts((prev) => {
      const idx = prev.findIndex((a) => a.id === updated.id);
      if (idx === -1 && updated.isActive) return [...prev, updated];
      if (!updated.isActive) return prev.filter((a) => a.id !== updated.id);
      const next = [...prev];
      next[idx] = updated;
      return next;
    });
  });

  const isGroupJid = jid?.endsWith("@g.us") ?? false;

  if (hideIfSingle && accounts.length <= 1) return null;

  return (
    <div className={cn("flex items-center gap-1", className)}>
      {accounts.map((a) => {
        const isWabaGroupDisabled = disableWabaForGroup && a.type === "waba" && isGroupJid;
        const isSelected = selectedAccountId === a.id;
        return (
          <button
            key={a.id}
            type="button"
            onClick={() => !isWabaGroupDisabled && onSelect(a.id)}
            disabled={isWabaGroupDisabled}
            title={
              isWabaGroupDisabled
                ? "WABA cannot send to groups"
                : `Send via ${a.displayName || typeLabel(a.type)}`
            }
            className={cn(
              "rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors",
              isSelected
                ? "border-accent bg-accent/20 text-white"
                : "border-card-border bg-transparent text-muted-text hover:border-accent/50 hover:text-white",
              isWabaGroupDisabled && "cursor-not-allowed opacity-40",
            )}
          >
            {a.displayName || typeLabel(a.type)}
          </button>
        );
      })}
    </div>
  );
}
