import path from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

/** `backend/auth_info` — root dir for per-account auth subdirectories */
export const authInfoRoot = path.join(__dirname, "../auth_info");

/** Deterministic UUID for the seeded primary Baileys account. Also set in Migration 001. */
export const PRIMARY_BAILEYS_ACCOUNT_ID =
  process.env.PRIMARY_BAILEYS_ACCOUNT_ID ?? "00000000-0000-4000-a000-000000000001";

function resolveDatabaseUrl(): string {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  if (process.env.DATABASE_SECRET) {
    const s = JSON.parse(process.env.DATABASE_SECRET) as {
      username: string;
      password: string;
      host: string;
      port: number | string;
      dbname: string;
    };
    const u = encodeURIComponent(s.username);
    const p = encodeURIComponent(s.password);
    return `postgres://${u}:${p}@${s.host}:${s.port}/${s.dbname}`;
  }
  return "postgres://postgres:postgres@localhost:5432/wa_automation";
}

export const config = {
  port: Number(process.env.BACKEND_PORT ?? 4100),
  frontendOrigin: process.env.FRONTEND_ORIGIN ?? "http://localhost:3100",
  databaseUrl: resolveDatabaseUrl(),
  /** Only true when TYPEORM_SYNC=true is set explicitly — use migrations in all other cases */
  typeormSync: process.env.TYPEORM_SYNC === "true",
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
