import type { MigrationInterface, QueryRunner } from "typeorm";

export class AddTemplatesAndDeliveries1700000000003 implements MigrationInterface {
  name = "AddTemplatesAndDeliveries1700000000003";

  async up(queryRunner: QueryRunner): Promise<void> {
    // ── message_templates ─────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_templates" (
        "id"                  uuid          NOT NULL DEFAULT gen_random_uuid(),
        "account_id"          uuid          NOT NULL,
        "meta_template_id"    varchar(64)   NULL,
        "name"                varchar(128)  NOT NULL,
        "language"            varchar(16)   NOT NULL,
        "category"            varchar(32)   NOT NULL,
        "status"              varchar(32)   NOT NULL,
        "components_json"     jsonb         NULL,
        "placeholders_json"   jsonb         NULL,
        "last_synced_at"      timestamptz   NULL,
        "created_at"          timestamptz   NOT NULL DEFAULT now(),
        "updated_at"          timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_message_templates" PRIMARY KEY ("id")
      )
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_template_account_name_lang"
      ON "message_templates" ("account_id", "name", "language")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_template_account_status"
      ON "message_templates" ("account_id", "status")
    `);
    await queryRunner.query(`
      ALTER TABLE "message_templates"
      ADD CONSTRAINT "FK_message_templates_account"
      FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE
    `);

    // ── message_deliveries ────────────────────────────────────────────────────
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "message_deliveries" (
        "account_id"          uuid          NOT NULL,
        "provider_message_id" varchar(128)  NOT NULL,
        "recipient_jid"       varchar(64)   NULL,
        "status"              varchar(16)   NOT NULL,
        "status_at"           timestamptz   NOT NULL,
        "error_code"          varchar(32)   NULL,
        "error_title"         varchar(128)  NULL,
        "error_message"       text          NULL,
        "updated_at"          timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_message_deliveries" PRIMARY KEY ("account_id", "provider_message_id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_delivery_account_jid"
      ON "message_deliveries" ("account_id", "recipient_jid")
    `);
    await queryRunner.query(`
      ALTER TABLE "message_deliveries"
      ADD CONSTRAINT "FK_message_deliveries_account"
      FOREIGN KEY ("account_id") REFERENCES "whatsapp_accounts"("id") ON DELETE CASCADE
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`ALTER TABLE "message_deliveries" DROP CONSTRAINT IF EXISTS "FK_message_deliveries_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_delivery_account_jid"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "message_deliveries"`);

    await queryRunner.query(`ALTER TABLE "message_templates" DROP CONSTRAINT IF EXISTS "FK_message_templates_account"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_template_account_status"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_template_account_name_lang"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "message_templates"`);
  }
}
