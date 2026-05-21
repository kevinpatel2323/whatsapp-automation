"use client";

import { useEffect, useState } from "react";
import { Loader2, RefreshCw, X } from "lucide-react";
import type { MessageTemplate } from "@/lib/types";
import { fetchTemplates, syncTemplates } from "@/lib/accounts";
import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";

interface Props {
  accountId: string;
  onSelect: (template: MessageTemplate, params: Record<string, string>) => void;
  onClose: () => void;
}

export function TemplatePicker({ accountId, onSelect, onClose }: Props) {
  const [templates, setTemplates] = useState<MessageTemplate[]>([]);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [selected, setSelected] = useState<MessageTemplate | null>(null);
  const [params, setParams] = useState<Record<string, string>>({});

  useEffect(() => {
    fetchTemplates(accountId)
      .then((d) => setTemplates(d.templates.filter((t) => t.status === "APPROVED")))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, [accountId]);

  useEffect(() => {
    if (selected) {
      const defaults: Record<string, string> = {};
      for (const p of selected.placeholders) defaults[p] = "";
      setParams(defaults);
    }
  }, [selected]);

  const handleSync = async () => {
    setSyncing(true);
    try {
      const d = await syncTemplates(accountId);
      setTemplates(d.templates.filter((t) => t.status === "APPROVED"));
    } catch (e) {
      console.error(e);
    } finally {
      setSyncing(false);
    }
  };

  const handleSend = () => {
    if (!selected) return;
    onSelect(selected, params);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 backdrop-blur-sm sm:items-center">
      <div className="flex max-h-[85vh] w-full max-w-lg flex-col rounded-t-2xl border border-card-border bg-forest shadow-2xl sm:rounded-2xl">
        {/* Header */}
        <div className="flex shrink-0 items-center justify-between border-b border-card-border/60 px-4 py-3">
          <h2 className="font-display text-base font-semibold text-white">Send Template</h2>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => void handleSync()}
              disabled={syncing}
              title="Sync templates from Meta"
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-text transition hover:bg-white/10 hover:text-white"
            >
              <RefreshCw className={cn("h-4 w-4", syncing && "animate-spin")} />
            </button>
            <button
              type="button"
              onClick={onClose}
              className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted-text transition hover:bg-white/10 hover:text-white"
            >
              <X className="h-4 w-4" />
            </button>
          </div>
        </div>

        {/* Content */}
        <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
          {loading ? (
            <div className="flex flex-1 items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-neon-green" />
            </div>
          ) : templates.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-text">
              No approved templates found.{" "}
              <button
                type="button"
                onClick={() => void handleSync()}
                className="text-neon-green underline"
              >
                Sync from Meta
              </button>
            </div>
          ) : (
            <div className="space-y-1 p-2">
              {templates.map((t) => (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelected(t)}
                  className={cn(
                    "w-full rounded-xl border px-3 py-2.5 text-left text-sm transition",
                    selected?.id === t.id
                      ? "border-neon-green/40 bg-neon-green/10 text-white"
                      : "border-transparent text-muted-text hover:border-card-border hover:bg-white/5 hover:text-white",
                  )}
                >
                  <div className="font-medium">{t.name}</div>
                  <div className="mt-0.5 text-[11px] opacity-60">
                    {t.language} · {t.category}
                    {t.placeholders.length > 0 && ` · {{${t.placeholders.join("}}, {{")}}`}
                  </div>
                </button>
              ))}
            </div>
          )}

          {/* Param inputs for selected template */}
          {selected && selected.placeholders.length > 0 && (
            <div className="shrink-0 space-y-2 border-t border-card-border/60 px-4 py-3">
              <p className="text-xs font-medium text-muted-text">Fill placeholders</p>
              {selected.placeholders.map((k) => (
                <div key={k} className="flex items-center gap-2">
                  <span className="w-8 shrink-0 text-right text-xs text-muted-text">{`{{${k}}}`}</span>
                  <input
                    type="text"
                    value={params[k] ?? ""}
                    onChange={(e) => setParams((p) => ({ ...p, [k]: e.target.value }))}
                    placeholder={`Value for {{${k}}}`}
                    className="flex-1 rounded-lg border border-card-border bg-dark-forest/80 px-2.5 py-1.5 text-sm text-white placeholder:text-muted-text/60 focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-neon-green"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex shrink-0 justify-end gap-2 border-t border-card-border/60 px-4 py-3">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={onClose}
            className="border-card-border bg-transparent text-muted-text hover:bg-white/10"
          >
            Cancel
          </Button>
          <Button
            type="button"
            size="sm"
            onClick={handleSend}
            disabled={!selected}
            className="border-neon-green/40 bg-neon-green/15 text-neon-green hover:bg-neon-green/25 disabled:opacity-40"
          >
            Send Template
          </Button>
        </div>
      </div>
    </div>
  );
}
