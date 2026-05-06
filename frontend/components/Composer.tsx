"use client";

import { useState } from "react";
import { Loader2, SendHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

type Props = {
  disabled: boolean;
  placeholder?: string;
  onSend: (text: string) => Promise<void> | void;
};

export function Composer({ disabled, placeholder = "Type a message", onSend }: Props) {
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);

  const submit = async () => {
    const trimmed = text.trim();
    if (!trimmed || disabled || sending) return;
    setSending(true);
    try {
      await onSend(trimmed);
      setText("");
    } finally {
      setSending(false);
    }
  };

  return (
    <form
      className="flex shrink-0 items-end gap-2 border-t border-card-border/70 bg-deep-teal/80 px-3 py-3 sm:px-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <label htmlFor="wa-composer" className="sr-only">
        Message
      </label>
      <textarea
        id="wa-composer"
        rows={1}
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && !e.shiftKey) {
            e.preventDefault();
            void submit();
          }
        }}
        placeholder={placeholder}
        disabled={disabled || sending}
        className={cn(
          "max-h-32 min-h-[44px] flex-1 resize-y rounded-2xl border border-card-border bg-dark-forest/90 px-3 py-2.5 text-sm text-white placeholder:text-muted-text",
          "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-neon-green",
        )}
      />
      <button
        type="submit"
        disabled={disabled || sending || !text.trim()}
        className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-neon-green text-void transition hover:bg-neon-green/90 disabled:pointer-events-none disabled:opacity-40"
        aria-label="Send"
      >
        {sending ? (
          <Loader2 className="h-5 w-5 animate-spin" aria-hidden />
        ) : (
          <SendHorizontal className="h-5 w-5" aria-hidden />
        )}
      </button>
    </form>
  );
}
