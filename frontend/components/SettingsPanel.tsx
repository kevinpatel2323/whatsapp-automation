"use client";

import { useCallback, useEffect, useState } from "react";
import { getJson, patchJson } from "@/lib/api";
import type { Account, AutoReplySettingsDto, MatchRouting, MessageTemplate, ReplyExclusionDto } from "@/lib/types";
import { fetchAccounts, fetchTemplates } from "@/lib/accounts";
import { Plus, Trash2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useSocketEvent } from "@/lib/use-socket-event";

const empty: AutoReplySettingsDto = {
  enabled: true,
  buyEnabled: true,
  sellEnabled: true,
  ignoreIntent: true,
  matches: ["MI vs CSK"],
  matchReplies: {},
  replyText: "",
  cooldownMinutes: 60,
  replyExclusions: [],
  updatedAt: "",
};

type MatchRow = { key: string; match: string; text: string; routing: MatchRouting | null };

function newRow(): MatchRow {
  return { key: crypto.randomUUID(), match: "", text: "", routing: null };
}

function rowsFromDto(d: AutoReplySettingsDto): MatchRow[] {
  const mr = d.matchReplies ?? {};
  const routing = d.replyRouting ?? {};
  const fromMap = Object.entries(mr);
  if (fromMap.length > 0) {
    return fromMap.map(([k, v]) => ({
      key: crypto.randomUUID(),
      match: k,
      text: v,
      routing: routing[k] ?? null,
    }));
  }
  const labels = d.matches ?? [];
  if (labels.length > 0) {
    return labels.map((label) => ({
      key: crypto.randomUUID(),
      match: label,
      text: "",
      routing: routing[label] ?? null,
    }));
  }
  return [newRow()];
}

type ExclusionRow = { key: string; name: string; value: string };

function newExclusionRow(): ExclusionRow {
  return { key: crypto.randomUUID(), name: "", value: "" };
}

function exclusionRowsFromDto(d: AutoReplySettingsDto): ExclusionRow[] {
  const list = d.replyExclusions ?? [];
  if (list.length === 0) {
    return [newExclusionRow()];
  }
  return list.map((e) => ({
    key: crypto.randomUUID(),
    name: e.name,
    value: e.value,
  }));
}

// Custom toggle switch component
function ToggleSwitch({
  checked,
  onChange,
  disabled,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  disabled?: boolean;
  id?: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      id={id}
      disabled={disabled}
      onClick={() => !disabled && onChange(!checked)}
      className={cn(
        "relative inline-flex h-5 w-9 shrink-0 cursor-pointer items-center rounded-full transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-neon-green/30 focus:ring-offset-1 focus:ring-offset-dark-forest",
        checked ? "bg-neon-green" : "bg-shade-70",
        disabled && "opacity-40 cursor-not-allowed",
      )}
    >
      <span
        className={cn(
          "inline-block h-3.5 w-3.5 rounded-full bg-white shadow transition-transform duration-200",
          checked ? "translate-x-4" : "translate-x-0.5",
        )}
      />
    </button>
  );
}

const inputCls =
  "w-full bg-dark-forest border border-shade-70 rounded-lg px-2 py-1.5 text-white text-xs focus:outline-none focus:border-neon-green focus:ring-2 focus:ring-neon-green/30";

export function SettingsPanel() {
  const [s, setS] = useState<AutoReplySettingsDto>(empty);
  const [rows, setRows] = useState<MatchRow[]>([newRow()]);
  const [exclRows, setExclRows] = useState<ExclusionRow[]>([newExclusionRow()]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [savedMsg, setSavedMsg] = useState<string | null>(null);
  const [externalUpdate, setExternalUpdate] = useState(false);
  const [accounts, setAccounts] = useState<Account[]>([]);
  const [templatesByAccount, setTemplatesByAccount] = useState<Record<string, MessageTemplate[]>>({});

  const applyDto = useCallback((d: AutoReplySettingsDto) => {
    setS(d);
    setRows(rowsFromDto(d));
    setExclRows(exclusionRowsFromDto(d));
  }, []);

  const load = useCallback(async () => {
    try {
      const d = await getJson<AutoReplySettingsDto>("/api/settings");
      applyDto(d);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Load failed");
    }
  }, [applyDto]);

  useEffect(() => {
    void load();
    fetchAccounts()
      .then((accts) => setAccounts(accts))
      .catch(() => {/* non-fatal */});
  }, [load]);

  const loadTemplatesForAccount = useCallback(async (accountId: string) => {
    if (templatesByAccount[accountId]) return;
    try {
      const d = await fetchTemplates(accountId);
      setTemplatesByAccount((prev) => ({
        ...prev,
        [accountId]: d.templates.filter((t) => t.status === "APPROVED"),
      }));
    } catch {
      // non-fatal
    }
  }, [templatesByAccount]);

  useSocketEvent("settings:updated", (d) => {
    const p = d as AutoReplySettingsDto;
    if (p && typeof p === "object" && "replyText" in p) {
      applyDto(p);
      setExternalUpdate(true);
    }
  });

  // Clear external update notice when user edits any field
  const clearExternal = () => setExternalUpdate(false);

  const updateRow = (key: string, field: "match" | "text", value: string) => {
    clearExternal();
    setRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const addRow = () => {
    clearExternal();
    setRows((prev) => [...prev, newRow()]);
  };

  const removeRow = (key: string) => {
    clearExternal();
    setRows((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.length > 0 ? next : [newRow()];
    });
  };

  const updateRowRouting = (key: string, patch: Partial<MatchRouting> | null) => {
    clearExternal();
    setRows((prev) =>
      prev.map((r) => {
        if (r.key !== key) return r;
        if (patch === null) return { ...r, routing: null };
        const existing = r.routing ?? { accountId: "", mode: "baileys-text" as const };
        return { ...r, routing: { ...existing, ...patch } };
      }),
    );
  };

  const updateExclRow = (key: string, field: "name" | "value", value: string) => {
    clearExternal();
    setExclRows((prev) => prev.map((r) => (r.key === key ? { ...r, [field]: value } : r)));
  };

  const addExclRow = () => {
    clearExternal();
    setExclRows((prev) => [...prev, newExclusionRow()]);
  };

  const removeExclRow = (key: string) => {
    clearExternal();
    setExclRows((prev) => {
      const next = prev.filter((r) => r.key !== key);
      return next.length > 0 ? next : [newExclusionRow()];
    });
  };

  const save = async () => {
    setBusy(true);
    setErr(null);
    setSavedMsg(null);
    try {
      const matchReplies: Record<string, string> = {};
      for (const r of rows) {
        const label = r.match.trim();
        if (!label) continue;
        matchReplies[label] = r.text;
      }
      const matchKeys = Object.keys(matchReplies);
      const replyExclusions: ReplyExclusionDto[] = [];
      for (const r of exclRows) {
        const v = r.value.trim();
        if (!v) continue;
        replyExclusions.push({ name: r.name.trim(), value: v });
      }
      const replyRouting: Record<string, MatchRouting> = {};
      for (const r of rows) {
        const label = r.match.trim();
        if (label && r.routing && r.routing.mode !== "baileys-text") {
          replyRouting[label] = r.routing;
        }
      }
      const d = await patchJson<AutoReplySettingsDto>("/api/settings", {
        enabled: s.enabled,
        buyEnabled: s.buyEnabled,
        sellEnabled: s.sellEnabled,
        ignoreIntent: s.ignoreIntent,
        matchReplies,
        matches: matchKeys,
        replyText: s.replyText,
        cooldownMinutes: s.cooldownMinutes,
        replyExclusions,
        replyRouting,
      });
      applyDto(d);
      setSavedMsg("Saved.");
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Save failed");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="bg-deep-teal border border-card-border rounded-lg shadow-card space-y-4 p-4 text-sm">
      {/* External update notice */}
      {externalUpdate && (
        <div className="flex items-center justify-between gap-2 rounded-lg border border-neon-green/30 bg-neon-green/10 px-3 py-2 text-xs text-neon-green">
          <span>Updated externally</span>
          <button
            type="button"
            onClick={() => setExternalUpdate(false)}
            className="text-neon-green/70 hover:text-neon-green transition-colors"
            aria-label="Dismiss"
          >
            ✕
          </button>
        </div>
      )}

      {err && (
        <p className="text-red-400 text-xs border border-red-500/30 rounded-lg p-2">{err}</p>
      )}
      {savedMsg && <p className="text-neon-green text-xs">{savedMsg}</p>}

      <p className="text-xs text-muted-text">
        When a listed match is detected in a message, a DM is sent to that person (one per{" "}
        {s.cooldownMinutes} min per contact) if you enable a reply for that match or set a fallback
        below. With &quot;Ignore intent&quot; on, WTB/WTS patterns are not required. Only live{" "}
        <code className="mx-1 text-[10px]">notify</code> messages are auto-answered, not history
        sync.
      </p>

      {/* Enable auto-reply toggle */}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="toggle-enabled" className="text-white text-xs cursor-pointer">
          Enable auto-reply
        </label>
        <ToggleSwitch
          id="toggle-enabled"
          checked={s.enabled}
          onChange={(v) => { clearExternal(); setS((x) => ({ ...x, enabled: v })); }}
        />
      </div>

      {/* Ignore intent toggle */}
      <div className="flex items-center justify-between gap-3">
        <label htmlFor="toggle-ignore-intent" className="text-white text-xs cursor-pointer">
          Ignore intent{" "}
          <span className="text-muted-text">(send when match is mentioned; ignore WTB/WTS)</span>
        </label>
        <ToggleSwitch
          id="toggle-ignore-intent"
          checked={s.ignoreIntent}
          onChange={(v) => { clearExternal(); setS((x) => ({ ...x, ignoreIntent: v })); }}
          disabled={!s.enabled}
        />
      </div>

      {/* Buy / Sell intent toggles */}
      <div
        className={cn(
          "flex flex-wrap gap-4 rounded-lg border border-shade-70 p-3",
          s.ignoreIntent && "opacity-50",
        )}
      >
        <div className="flex items-center justify-between gap-3 flex-1 min-w-[140px]">
          <label htmlFor="toggle-buy" className="text-white text-xs cursor-pointer">
            WTB (buy) intent
          </label>
          <ToggleSwitch
            id="toggle-buy"
            checked={s.buyEnabled}
            onChange={(v) => { clearExternal(); setS((x) => ({ ...x, buyEnabled: v })); }}
            disabled={!s.enabled || s.ignoreIntent}
          />
        </div>
        <div className="flex items-center justify-between gap-3 flex-1 min-w-[140px]">
          <label htmlFor="toggle-sell" className="text-white text-xs cursor-pointer">
            WTS (sell) intent
          </label>
          <ToggleSwitch
            id="toggle-sell"
            checked={s.sellEnabled}
            onChange={(v) => { clearExternal(); setS((x) => ({ ...x, sellEnabled: v })); }}
            disabled={!s.enabled || s.ignoreIntent}
          />
        </div>
      </div>

      {/* Per-match replies */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-text">Per-match replies</p>
          <button
            type="button"
            onClick={addRow}
            disabled={!s.enabled}
            className="flex items-center gap-1 rounded-full border border-shade-70 px-3 py-1 text-xs text-white hover:border-neon-green/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
            Add match
          </button>
        </div>
        {rows.map((row) => {
          const mode = row.routing?.mode ?? "baileys-text";
          const routingAccountId = row.routing?.accountId ?? "";
          const wabaAccounts = accounts.filter((a) => a.type === "waba");
          const rowTemplates: MessageTemplate[] = routingAccountId ? (templatesByAccount[routingAccountId] ?? []) : [];

          return (
          <div
            key={row.key}
            className="space-y-1.5 rounded-lg border border-shade-70 p-3 bg-dark-forest"
          >
            <div className="flex gap-1 items-start">
              <div className="flex-1 min-w-0 space-y-1">
                <p className="text-[10px] text-muted-text">Match (e.g. MI vs CSK)</p>
                <input
                  className={inputCls}
                  value={row.match}
                  onChange={(e) => updateRow(row.key, "match", e.target.value)}
                  placeholder="DC vs RCB"
                  disabled={!s.enabled}
                />
                {mode !== "waba-template" && (
                  <>
                    <p className="text-[10px] text-muted-text">Message for this match</p>
                    <textarea
                      className={cn(inputCls, "min-h-[3.5rem]")}
                      value={row.text}
                      onChange={(e) => updateRow(row.key, "text", e.target.value)}
                      placeholder="Your DM text…"
                      disabled={!s.enabled}
                    />
                  </>
                )}
              </div>
              <button
                type="button"
                className="h-8 w-8 shrink-0 mt-5 flex items-center justify-center rounded-lg text-muted-text hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
                onClick={() => removeRow(row.key)}
                disabled={!s.enabled}
                title="Remove row"
              >
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </div>

            {/* Routing section */}
            <div className="pt-1 border-t border-shade-70/50 space-y-1.5">
              <p className="text-[10px] text-muted-text">Send via</p>
              <select
                className={cn(inputCls, "cursor-pointer")}
                value={mode}
                disabled={!s.enabled}
                onChange={(e) => {
                  const m = e.target.value as MatchRouting["mode"];
                  if (m === "baileys-text") {
                    updateRowRouting(row.key, null);
                  } else {
                    updateRowRouting(row.key, { mode: m, accountId: routingAccountId || (wabaAccounts[0]?.id ?? "") });
                    const loadId = routingAccountId || (wabaAccounts[0]?.id ?? "");
                    if (m === "waba-template" && loadId) {
                      void loadTemplatesForAccount(loadId);
                    }
                  }
                }}
              >
                <option value="baileys-text">Baileys (default)</option>
                <option value="waba-text">WABA — text</option>
                <option value="waba-template">WABA — template</option>
              </select>

              {(mode === "waba-text" || mode === "waba-template") && wabaAccounts.length > 0 && (
                <>
                  <p className="text-[10px] text-muted-text">WABA account</p>
                  <select
                    className={cn(inputCls, "cursor-pointer")}
                    value={routingAccountId}
                    disabled={!s.enabled}
                    onChange={(e) => {
                      updateRowRouting(row.key, { accountId: e.target.value });
                      if (mode === "waba-template" && e.target.value) {
                        void loadTemplatesForAccount(e.target.value);
                      }
                    }}
                  >
                    <option value="">— pick account —</option>
                    {wabaAccounts.map((a) => (
                      <option key={a.id} value={a.id}>
                        {a.displayName}{a.phoneE164 ? ` (${a.phoneE164})` : ""}
                      </option>
                    ))}
                  </select>
                </>
              )}

              {mode === "waba-template" && routingAccountId && (
                <>
                  <p className="text-[10px] text-muted-text">Template</p>
                  <select
                    className={cn(inputCls, "cursor-pointer")}
                    value={row.routing?.templateId ?? ""}
                    disabled={!s.enabled}
                    onChange={(e) => updateRowRouting(row.key, { templateId: e.target.value || null })}
                  >
                    <option value="">— pick template —</option>
                    {rowTemplates.map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name} ({t.language})
                      </option>
                    ))}
                  </select>

                  {row.routing?.templateId && (() => {
                    const tpl = rowTemplates.find((t) => t.id === row.routing?.templateId);
                    if (!tpl || tpl.placeholders.length === 0) return null;
                    const params = row.routing.templateParamsTemplate ?? {};
                    return (
                      <div className="space-y-1">
                        <p className="text-[10px] text-muted-text">
                          Param templates — use <code>{"{{senderName}}"}</code>, <code>{"{{match}}"}</code>, <code>{"{{senderPhone}}"}</code>
                        </p>
                        {tpl.placeholders.map((p) => (
                          <div key={p} className="flex items-center gap-2">
                            <span className="w-6 shrink-0 text-right text-[10px] text-muted-text">{`{{${p}}}`}</span>
                            <input
                              type="text"
                              className={inputCls}
                              value={params[p] ?? ""}
                              disabled={!s.enabled}
                              placeholder={`Value for {{${p}}}`}
                              onChange={(e) => {
                                const newParams = { ...params, [p]: e.target.value };
                                updateRowRouting(row.key, { templateParamsTemplate: newParams });
                              }}
                            />
                          </div>
                        ))}
                      </div>
                    );
                  })()}
                </>
              )}
            </div>
          </div>
          );
        })}
      </div>

      {/* Exclusions */}
      <div className="space-y-3">
        <div className="flex items-center justify-between gap-2">
          <p className="text-xs text-muted-text">Never auto-reply to</p>
          <button
            type="button"
            onClick={addExclRow}
            disabled={!s.enabled}
            className="flex items-center gap-1 rounded-full border border-shade-70 px-3 py-1 text-xs text-white hover:border-neon-green/50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          >
            <Plus className="h-3.5 w-3.5" />
            Add
          </button>
        </div>
        <p className="text-[10px] text-muted-text -mt-1">
          Reference name and phone (with country code) or full JID. Matched before sending (groups
          and 1:1).
        </p>
        {exclRows.map((er) => (
          <div
            key={er.key}
            className="flex gap-1.5 items-start rounded-lg border border-shade-70 p-3 bg-dark-forest"
          >
            <div className="flex-1 min-w-0 grid grid-cols-1 sm:grid-cols-2 gap-2">
              <div>
                <p className="text-[10px] text-muted-text mb-0.5">Name</p>
                <input
                  className={inputCls}
                  value={er.name}
                  onChange={(e) => updateExclRow(er.key, "name", e.target.value)}
                  placeholder="e.g. Partner"
                  disabled={!s.enabled}
                />
              </div>
              <div>
                <p className="text-[10px] text-muted-text mb-0.5">Number or JID</p>
                <input
                  className={inputCls}
                  value={er.value}
                  onChange={(e) => updateExclRow(er.key, "value", e.target.value)}
                  placeholder="+91… or 123@lid"
                  disabled={!s.enabled}
                />
              </div>
            </div>
            <button
              type="button"
              className="h-8 w-8 shrink-0 mt-5 flex items-center justify-center rounded-lg text-muted-text hover:text-red-400 hover:bg-red-500/10 transition-colors disabled:opacity-40"
              onClick={() => removeExclRow(er.key)}
              disabled={!s.enabled}
              title="Remove"
            >
              <Trash2 className="h-3.5 w-3.5" />
            </button>
          </div>
        ))}
      </div>

      {/* Fallback reply */}
      <div>
        <p className="text-xs text-muted-text mb-1">
          Fallback reply (used when a match has no specific text above, or is empty)
        </p>
        <textarea
          className={cn(inputCls, "min-h-[2.5rem]")}
          value={s.replyText}
          onChange={(e) => { clearExternal(); setS((x) => ({ ...x, replyText: e.target.value })); }}
          disabled={!s.enabled}
        />
      </div>

      {/* Cooldown + Save */}
      <div className="flex items-end gap-3">
        <div>
          <p className="text-xs text-muted-text mb-1">Cooldown (minutes)</p>
          <input
            type="number"
            min={1}
            className={cn(inputCls, "w-24")}
            value={s.cooldownMinutes}
            onChange={(e) => {
              clearExternal();
              setS((x) => ({
                ...x,
                cooldownMinutes: Math.max(1, Number(e.target.value) || 1),
              }));
            }}
            disabled={!s.enabled}
          />
        </div>
        <button
          type="button"
          onClick={save}
          disabled={busy}
          className="rounded-full bg-white text-black px-4 py-2 min-h-[48px] font-medium transition-all duration-200 hover:bg-white/90 disabled:opacity-50 disabled:cursor-not-allowed shrink-0"
        >
          {busy ? "Saving…" : "Save settings"}
        </button>
      </div>

      {s.updatedAt && (
        <p className="text-[10px] text-muted-text">Last updated: {s.updatedAt}</p>
      )}
    </div>
  );
}
