import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** `backend/auth_info` — next to `src/`, ESM-safe */
export const authDir = path.join(__dirname, "../auth_info");

export const config = {
  port: Number(process.env.BACKEND_PORT ?? 4100),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3100",
  databaseUrl: process.env.DATABASE_URL ?? "postgres://postgres:postgres@localhost:5432/wa_automation",
  /** false in production — use migrations */
  typeormSync:
    process.env.TYPEORM_SYNC === "true" || process.env.TYPEORM_SYNC == null,
  autoReply: {
    enabled: process.env.AUTO_REPLY_ENABLED !== "false",
    buyEnabled: process.env.AUTO_REPLY_BUY !== "false",
    sellEnabled: process.env.AUTO_REPLY_SELL !== "false",
    ignoreIntent: process.env.AUTO_REPLY_IGNORE_INTENT !== "false",
    /** Seeded as {}; configure per-match text via API/UI */
    matchReplies: {} as Record<string, string>,
    matches: (process.env.AUTO_REPLY_MATCHES ?? "MI vs CSK")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    cooldownMinutes: Math.max(1, Number.parseInt(process.env.AUTO_REPLY_COOLDOWN_MINUTES ?? "60", 10) || 60),
    text:
      process.env.AUTO_REPLY_TEXT ??
      "Hi! Saw your message about the match. I may be able to help — please share details.",
    replyExclusions: [] as Array<{ name: string; value: string }>,
  },
} as const;
