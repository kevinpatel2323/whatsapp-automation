import type { MigrationInterface, QueryRunner } from "typeorm";

const PRIMARY_ID = process.env.PRIMARY_BAILEYS_ACCOUNT_ID ?? "00000000-0000-4000-a000-000000000001";

export class AddAccountId1700000000002 implements MigrationInterface {
  name = "AddAccountId1700000000002";

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── messages ──────────────────────────────────────────────────────────────

    await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "account_id" uuid`);
    await queryRunner.query(`ALTER TABLE "messages" ADD COLUMN IF NOT EXISTS "provider" varchar(16) NOT NULL DEFAULT 'baileys'`);
    await queryRunner.query(`UPDATE "messages" SET "account_id" = $1 WHERE "account_id" IS NULL`, [PRIMARY_ID]);
    await queryRunner.query(`ALTER TABLE "messages" ALTER COLUMN "account_id" SET NOT NULL`);

    // Drop old PK and create composite
    await queryRunner.query(`
      DO $$ DECLARE pk text;
      BEGIN
        SELECT constraint_name INTO pk FROM information_schema.table_constraints
        WHERE table_name = 'messages' AND constraint_type = 'PRIMARY KEY';
        IF pk IS NOT NULL THEN EXECUTE 'ALTER TABLE messages DROP CONSTRAINT ' || quote_ident(pk); END IF;
      END $$
    `);
    await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "PK_messages" PRIMARY KEY ("account_id", "id", "remoteJid", "fromMe")`);

    // Update indexes
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_messages_remote_ts"`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_messages_account_remote_ts" ON "messages" ("account_id", "remoteJid", "messageTimestamp")`);

    // Add FK
    await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "FK_messages_account" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE`);

    // ── chats ─────────────────────────────────────────────────────────────────

    await queryRunner.query(`ALTER TABLE "chats" ADD COLUMN IF NOT EXISTS "account_id" uuid`);
    await queryRunner.query(`UPDATE "chats" SET "account_id" = $1 WHERE "account_id" IS NULL`, [PRIMARY_ID]);
    await queryRunner.query(`ALTER TABLE "chats" ALTER COLUMN "account_id" SET NOT NULL`);

    await queryRunner.query(`
      DO $$ DECLARE pk text;
      BEGIN
        SELECT constraint_name INTO pk FROM information_schema.table_constraints
        WHERE table_name = 'chats' AND constraint_type = 'PRIMARY KEY';
        IF pk IS NOT NULL THEN EXECUTE 'ALTER TABLE chats DROP CONSTRAINT ' || quote_ident(pk); END IF;
      END $$
    `);
    await queryRunner.query(`ALTER TABLE "chats" ADD CONSTRAINT "PK_chats" PRIMARY KEY ("account_id", "jid")`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chats_last_message"`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_chats_account_last_message" ON "chats" ("account_id", "lastMessageAt")`);

    await queryRunner.query(`ALTER TABLE "chats" ADD CONSTRAINT "FK_chats_account" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE`);

    // ── classified_messages ───────────────────────────────────────────────────

    await queryRunner.query(`ALTER TABLE "classified_messages" ADD COLUMN IF NOT EXISTS "account_id" uuid`);
    await queryRunner.query(`UPDATE "classified_messages" SET "account_id" = $1 WHERE "account_id" IS NULL`, [PRIMARY_ID]);
    await queryRunner.query(`ALTER TABLE "classified_messages" ALTER COLUMN "account_id" SET NOT NULL`);

    await queryRunner.query(`
      DO $$ DECLARE pk text;
      BEGIN
        SELECT constraint_name INTO pk FROM information_schema.table_constraints
        WHERE table_name = 'classified_messages' AND constraint_type = 'PRIMARY KEY';
        IF pk IS NOT NULL THEN EXECUTE 'ALTER TABLE classified_messages DROP CONSTRAINT ' || quote_ident(pk); END IF;
      END $$
    `);
    await queryRunner.query(`ALTER TABLE "classified_messages" ADD CONSTRAINT "PK_classified_messages" PRIMARY KEY ("account_id", "messageId", "remoteJid", "fromMe")`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cls_match_intent"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cls_remote_ts"`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_cls_account_match_intent" ON "classified_messages" ("account_id", "matchedMatch", "intent")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_cls_account_remote_ts" ON "classified_messages" ("account_id", "remoteJid", "messageTimestamp")`);

    await queryRunner.query(`ALTER TABLE "classified_messages" ADD CONSTRAINT "FK_classified_messages_account" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE`);

    // ── auto_reply_log ────────────────────────────────────────────────────────

    await queryRunner.query(`ALTER TABLE "auto_reply_log" ADD COLUMN IF NOT EXISTS "account_id" uuid`);
    await queryRunner.query(`UPDATE "auto_reply_log" SET "account_id" = $1 WHERE "account_id" IS NULL`, [PRIMARY_ID]);
    await queryRunner.query(`ALTER TABLE "auto_reply_log" ALTER COLUMN "account_id" SET NOT NULL`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_auto_reply_cp_sent"`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_auto_reply_account_cp_sent" ON "auto_reply_log" ("account_id", "counterparty_jid", "sent_at")`);

    await queryRunner.query(`ALTER TABLE "auto_reply_log" ADD CONSTRAINT "FK_auto_reply_log_account" FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE`);

    // ── auto_reply_settings ───────────────────────────────────────────────────

    await queryRunner.query(`ALTER TABLE "auto_reply_settings" ADD COLUMN IF NOT EXISTS "reply_routing" jsonb NOT NULL DEFAULT '{}'`);
    await queryRunner.query(`ALTER TABLE "auto_reply_settings" ADD COLUMN IF NOT EXISTS "default_routing" jsonb NULL`);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // auto_reply_settings
    await queryRunner.query(`ALTER TABLE "auto_reply_settings" DROP COLUMN IF EXISTS "default_routing"`);
    await queryRunner.query(`ALTER TABLE "auto_reply_settings" DROP COLUMN IF EXISTS "reply_routing"`);

    // auto_reply_log
    await queryRunner.query(`ALTER TABLE "auto_reply_log" DROP CONSTRAINT IF EXISTS "FK_auto_reply_log_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_auto_reply_account_cp_sent"`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_auto_reply_cp_sent" ON "auto_reply_log" ("counterparty_jid", "sent_at")`);
    await queryRunner.query(`ALTER TABLE "auto_reply_log" DROP COLUMN IF EXISTS "account_id"`);

    // classified_messages
    await queryRunner.query(`ALTER TABLE "classified_messages" DROP CONSTRAINT IF EXISTS "FK_classified_messages_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cls_account_match_intent"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_cls_account_remote_ts"`);
    await queryRunner.query(`ALTER TABLE "classified_messages" DROP CONSTRAINT IF EXISTS "PK_classified_messages"`);
    await queryRunner.query(`ALTER TABLE "classified_messages" ADD CONSTRAINT "PK_classified_messages" PRIMARY KEY ("messageId", "remoteJid", "fromMe")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_cls_match_intent" ON "classified_messages" ("matchedMatch", "intent")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_cls_remote_ts" ON "classified_messages" ("remoteJid", "messageTimestamp")`);
    await queryRunner.query(`ALTER TABLE "classified_messages" DROP COLUMN IF EXISTS "account_id"`);

    // chats
    await queryRunner.query(`ALTER TABLE "chats" DROP CONSTRAINT IF EXISTS "FK_chats_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_chats_account_last_message"`);
    await queryRunner.query(`ALTER TABLE "chats" DROP CONSTRAINT IF EXISTS "PK_chats"`);
    await queryRunner.query(`ALTER TABLE "chats" ADD CONSTRAINT "PK_chats" PRIMARY KEY ("jid")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_chats_last_message" ON "chats" ("lastMessageAt")`);
    await queryRunner.query(`ALTER TABLE "chats" DROP COLUMN IF EXISTS "account_id"`);

    // messages
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "FK_messages_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_messages_account_remote_ts"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP CONSTRAINT IF EXISTS "PK_messages"`);
    await queryRunner.query(`ALTER TABLE "messages" ADD CONSTRAINT "PK_messages" PRIMARY KEY ("id", "remoteJid", "fromMe")`);
    await queryRunner.query(`CREATE INDEX IF NOT EXISTS "idx_messages_remote_ts" ON "messages" ("remoteJid", "messageTimestamp")`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN IF EXISTS "provider"`);
    await queryRunner.query(`ALTER TABLE "messages" DROP COLUMN IF EXISTS "account_id"`);
  }
}
