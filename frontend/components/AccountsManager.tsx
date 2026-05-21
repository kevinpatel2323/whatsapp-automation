"use client";

import { useEffect, useState } from "react";
import { CheckCircle2, ChevronDown, ChevronUp, Copy, Loader2, LogOut, Plug, Plus, RefreshCw, Smartphone, Trash2 } from "lucide-react";
import { QRCodeSVG } from "qrcode.react";
import type { Account } from "@/lib/types";
import {
  addWabaAccount,
  connectAccount,
  fetchAccounts,
  fetchWebhookConfig,
  logoutAccount,
  removeAccount,
  statusColor,
  typeLabel,
  type AddWabaAccountInput,
} from "@/lib/accounts";
import { useSocketEvent } from "@/lib/use-socket-event";
import { cn } from "@/lib/utils";

function StatusDot({ status }: { status: Account["status"] }) {
  return (
    <span
      className={cn(
        "inline-block h-2 w-2 shrink-0 rounded-full",
        statusColor(status),
        status === "open" && "animate-pulse",
      )}
    />
  );
}

const inputCls =
  "w-full bg-dark-forest border border-shade-70 rounded-lg px-2.5 py-1.5 text-white text-xs focus:outline-none focus:border-neon-green focus:ring-1 focus:ring-neon-green/30 placeholder:text-muted-text/50";

type AccountCardProps = {
  account: Account;
  qr: string | null;
  onRemoved: () => void;
};

function AccountCard({ account, qr, onRemoved }: AccountCardProps) {
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [webhookCopied, setWebhookCopied] = useState(false);
  const [verifyTokenCopied, setVerifyTokenCopied] = useState(false);
  const [webhookConfig, setWebhookConfig] = useState<{ webhookUrl: string; webhookVerifyToken: string } | null>(null);
  const isOpen = account.status === "open";

  useEffect(() => {
    if (account.type === "waba") {
      fetchWebhookConfig(account.id)
        .then(setWebhookConfig)
        .catch(() => {/* non-fatal */});
    }
  }, [account.id, account.type]);

  const webhookUrl = webhookConfig?.webhookUrl ?? null;
  const webhookVerifyToken = webhookConfig?.webhookVerifyToken ?? null;

  const handleConnect = async () => {
    setBusy(true); setErr(null);
    try { await connectAccount(account.id); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const handleLogout = async () => {
    setBusy(true); setErr(null);
    try { await logoutAccount(account.id); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const handleRemove = async () => {
    if (!confirm(`Remove account "${account.displayName}"? This cannot be undone.`)) return;
    setBusy(true); setErr(null);
    try { await removeAccount(account.id); onRemoved(); }
    catch (e) { setErr(e instanceof Error ? e.message : "Failed"); }
    finally { setBusy(false); }
  };

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setWebhookCopied(true);
    setTimeout(() => setWebhookCopied(false), 2000);
  };

  const copyVerifyToken = async () => {
    if (!webhookVerifyToken) return;
    await navigator.clipboard.writeText(webhookVerifyToken);
    setVerifyTokenCopied(true);
    setTimeout(() => setVerifyTokenCopied(false), 2000);
  };

  return (
    <div className="space-y-3 rounded-lg border border-shade-70 bg-dark-forest p-3">
      {/* Header */}
      <div className="flex items-start gap-2.5">
        <StatusDot status={account.status} />
        <div className="min-w-0 flex-1">
          <p className="truncate text-xs font-medium text-white">{account.displayName}</p>
          {account.phoneE164 && (
            <p className="text-[10px] tabular-nums text-muted-text">{account.phoneE164}</p>
          )}
          <p className="text-[10px] text-muted-text capitalize">
            {typeLabel(account.type)} · {account.status}
          </p>
        </div>
        <span
          className={cn(
            "shrink-0 rounded px-1.5 py-0.5 text-[10px] font-medium",
            account.type === "waba"
              ? "bg-blue-500/15 text-blue-300 ring-1 ring-blue-500/25"
              : "bg-neon-green/10 text-neon-green ring-1 ring-neon-green/20",
          )}
        >
          {typeLabel(account.type)}
        </span>
      </div>

      {/* Baileys: QR / connected state */}
      {account.type === "baileys" && (
        <div className="rounded-xl border border-card-border/60 bg-dark-forest/50 p-3">
          {isOpen ? (
            <div className="flex items-center gap-3">
              <CheckCircle2 className="h-8 w-8 shrink-0 text-neon-green" strokeWidth={1.5} aria-hidden />
              <div>
                <p className="text-xs font-medium text-white">Linked</p>
                <p className="text-[10px] text-muted-text">Session active · messages streaming</p>
              </div>
            </div>
          ) : qr ? (
            <div className="flex flex-col items-center gap-3">
              <div className="rounded-xl bg-white p-2.5 shadow-md">
                <QRCodeSVG value={qr} size={160} level="M" />
              </div>
              <p className="max-w-[220px] text-center text-[10px] leading-relaxed text-muted-text">
                WhatsApp → Settings → Linked devices → Link a device
              </p>
            </div>
          ) : (
            <div className="flex items-center gap-3">
              <Smartphone className="h-7 w-7 shrink-0 text-muted-text" aria-hidden />
              <p className="text-xs text-muted-text">
                Tap <span className="font-semibold text-white">Connect</span> to show a QR code
              </p>
            </div>
          )}
        </div>
      )}

      {/* WABA: webhook config */}
      {account.type === "waba" && (
        <div className="space-y-2 rounded-lg border border-shade-70 bg-black/20 p-2.5">
          <div className="space-y-1">
            <p className="text-[10px] text-muted-text">Callback URL</p>
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">
                {webhookUrl ?? "—"}
              </p>
              {webhookUrl && (
                <button type="button" onClick={() => void copyWebhook()} className="shrink-0 text-muted-text transition hover:text-white" title="Copy">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {webhookCopied && <p className="text-[10px] text-neon-green">Copied!</p>}
          </div>

          <div className="space-y-1">
            <p className="text-[10px] text-muted-text">Verify token</p>
            <div className="flex items-center gap-1.5">
              <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">
                {webhookVerifyToken ?? "—"}
              </p>
              {webhookVerifyToken && (
                <button type="button" onClick={() => void copyVerifyToken()} className="shrink-0 text-muted-text transition hover:text-white" title="Copy">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              )}
            </div>
            {verifyTokenCopied && <p className="text-[10px] text-neon-green">Copied!</p>}
          </div>
        </div>
      )}

      {err && <p className="text-[10px] text-red-400">{err}</p>}

      {/* Actions */}
      <div className="flex gap-2">
        {account.type === "baileys" && (
          <>
            <button
              type="button"
              onClick={() => void handleConnect()}
              disabled={busy || isOpen}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full bg-white px-3 text-xs font-semibold text-void transition hover:bg-white/90 disabled:opacity-40 disabled:pointer-events-none"
            >
              {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plug className="h-3.5 w-3.5" />}
              Connect
            </button>
            <button
              type="button"
              onClick={() => void handleLogout()}
              disabled={busy}
              className="inline-flex h-8 flex-1 items-center justify-center gap-1.5 rounded-full border border-card-border bg-white/5 px-3 text-xs font-medium text-white transition hover:bg-white/10 disabled:opacity-40 disabled:pointer-events-none"
            >
              <LogOut className="h-3.5 w-3.5" />
              Logout
            </button>
          </>
        )}
        <button
          type="button"
          onClick={() => void handleRemove()}
          disabled={busy}
          title="Remove account"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-red-500/30 text-red-400 transition hover:bg-red-500/10 disabled:opacity-40 disabled:pointer-events-none"
        >
          <Trash2 className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

const EMPTY_FORM: AddWabaAccountInput = {
  displayName: "",
  phoneNumberId: "",
  businessAccountId: "",
  accessToken: "",
  appSecret: "",
  webhookVerifyToken: "",
  phoneE164: "",
};

function AddWabaForm({ onAdded }: { onAdded: () => void }) {
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState<AddWabaAccountInput>(EMPTY_FORM);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [webhookUrl, setWebhookUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const set = (field: keyof AddWabaAccountInput) => (e: React.ChangeEvent<HTMLInputElement>) =>
    setForm((prev) => ({ ...prev, [field]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true); setErr(null); setWebhookUrl(null);
    try {
      const result = await addWabaAccount(form);
      setWebhookUrl(result.webhookUrl);
      setForm(EMPTY_FORM);
      onAdded();
    } catch (err) {
      setErr(err instanceof Error ? err.message : "Failed");
    } finally {
      setBusy(false);
    }
  };

  const copyWebhook = async () => {
    if (!webhookUrl) return;
    await navigator.clipboard.writeText(webhookUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-lg border border-dashed border-shade-70 bg-dark-forest/40">
      <button
        type="button"
        onClick={() => { setOpen((o) => !o); setErr(null); setWebhookUrl(null); }}
        className="flex w-full items-center gap-2 px-3 py-2.5 text-left text-xs text-muted-text transition hover:text-white"
      >
        <Plus className="h-3.5 w-3.5 shrink-0" />
        <span className="flex-1">Add WABA account</span>
        {open ? <ChevronUp className="h-3.5 w-3.5 shrink-0" /> : <ChevronDown className="h-3.5 w-3.5 shrink-0" />}
      </button>

      {open && (
        <form onSubmit={(e) => void handleSubmit(e)} className="space-y-2 border-t border-shade-70/50 px-3 pb-3 pt-2.5">
          <p className="text-[10px] text-muted-text">
            Find these values in your{" "}
            <span className="text-white">Meta Business Suite → WhatsApp → API Setup</span>.
          </p>

          {[
            { field: "displayName" as const, label: "Display name", placeholder: "My WABA number" },
            { field: "phoneNumberId" as const, label: "Phone Number ID", placeholder: "123456789012345" },
            { field: "businessAccountId" as const, label: "Business Account ID", placeholder: "123456789012345" },
            { field: "phoneE164" as const, label: "Phone number (E.164, optional)", placeholder: "+919876543210" },
          ].map(({ field, label, placeholder }) => (
            <div key={field}>
              <p className="mb-0.5 text-[10px] text-muted-text">{label}</p>
              <input
                type="text"
                className={inputCls}
                value={form[field] ?? ""}
                onChange={set(field)}
                placeholder={placeholder}
                required={field !== "phoneE164"}
              />
            </div>
          ))}

          {[
            { field: "accessToken" as const, label: "Permanent access token", placeholder: "EAAxxxxxx…" },
            { field: "appSecret" as const, label: "App secret", placeholder: "abcdef1234…" },
            { field: "webhookVerifyToken" as const, label: "Webhook verify token (pick any string)", placeholder: "my-secret-token" },
          ].map(({ field, label, placeholder }) => (
            <div key={field}>
              <p className="mb-0.5 text-[10px] text-muted-text">{label}</p>
              <input
                type="password"
                autoComplete="off"
                className={inputCls}
                value={form[field] ?? ""}
                onChange={set(field)}
                placeholder={placeholder}
                required
              />
            </div>
          ))}

          {err && <p className="text-[10px] text-red-400">{err}</p>}

          {webhookUrl && (
            <div className="space-y-1 rounded-lg border border-neon-green/25 bg-neon-green/5 p-2.5">
              <p className="text-[10px] font-medium text-neon-green">Account created! Set this webhook URL in Meta dashboard:</p>
              <div className="flex items-center gap-1.5">
                <p className="min-w-0 flex-1 truncate font-mono text-[10px] text-zinc-300">{webhookUrl}</p>
                <button type="button" onClick={() => void copyWebhook()} className="shrink-0 text-neon-green/70 hover:text-neon-green">
                  <Copy className="h-3.5 w-3.5" />
                </button>
              </div>
              {copied && <p className="text-[10px] text-neon-green">Copied!</p>}
            </div>
          )}

          <button
            type="submit"
            disabled={busy}
            className="mt-1 inline-flex h-8 w-full items-center justify-center gap-1.5 rounded-full bg-white text-xs font-semibold text-void transition hover:bg-white/90 disabled:opacity-40 disabled:pointer-events-none"
          >
            {busy ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Plus className="h-3.5 w-3.5" />}
            Add account
          </button>
        </form>
      )}
    </div>
  );
}

export function AccountsManager() {
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [loading, setLoading] = useState(true);
  const [qrByAccount, setQrByAccount] = useState<Record<string, string>>({});

  const reload = () => {
    setLoading(true);
    fetchAccounts()
      .then(setAccounts)
      .catch(() => {/* non-fatal */})
      .finally(() => setLoading(false));
  };

  useEffect(() => { reload(); }, []);

  useSocketEvent("account:updated", (d) => {
    const updated = d as Account;
    setAccounts((prev) => {
      const idx = prev.findIndex((a) => a.id === updated.id);
      if (idx === -1) return [...prev, updated];
      return prev.map((a) => (a.id === updated.id ? updated : a));
    });
  });

  useSocketEvent("connection:state", (d) => {
    const { accountId, state } = d as { accountId?: string; state: string };
    if (!accountId) return;
    setAccounts((prev) =>
      prev.map((a) => (a.id === accountId ? { ...a, status: state as Account["status"] } : a)),
    );
    if (state === "open") {
      setQrByAccount((prev) => { const next = { ...prev }; delete next[accountId]; return next; });
    }
  });

  useSocketEvent("qr", (d) => {
    const { accountId, qr } = d as { accountId?: string; qr: string };
    if (!accountId || !qr) return;
    setQrByAccount((prev) => ({ ...prev, [accountId]: qr }));
  });

  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <p className="text-xs text-muted-text">Connected accounts</p>
        <button
          type="button"
          onClick={reload}
          disabled={loading}
          title="Refresh accounts"
          className="inline-flex h-7 w-7 items-center justify-center rounded-lg text-muted-text transition hover:bg-white/10 hover:text-white disabled:opacity-40"
        >
          <RefreshCw className={cn("h-3.5 w-3.5", loading && "animate-spin")} />
        </button>
      </div>

      {loading && <p className="text-xs text-muted-text">Loading…</p>}

      {accounts.map((a) => (
        <AccountCard
          key={a.id}
          account={a}
          qr={qrByAccount[a.id] ?? null}
          onRemoved={reload}
        />
      ))}

      <AddWabaForm onAdded={reload} />
    </div>
  );
}
