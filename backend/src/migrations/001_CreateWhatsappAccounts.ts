import type { MigrationInterface, QueryRunner } from "typeorm";

/** UUID for the seeded primary Baileys account. Must match PRIMARY_BAILEYS_ACCOUNT_ID env var. */
const PRIMARY_ID = process.env.PRIMARY_BAILEYS_ACCOUNT_ID ?? "00000000-0000-4000-a000-000000000001";

export class CreateWhatsappAccounts1700000000001 implements MigrationInterface {
  name = "CreateWhatsappAccounts1700000000001";

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "whatsapp_accounts" (
        "id"                          uuid          NOT NULL DEFAULT gen_random_uuid(),
        "type"                        varchar(16)   NOT NULL,
        "display_name"                varchar(128)  NOT NULL,
        "phone_e164"                  varchar(20)   NULL,
        "is_active"                   boolean       NOT NULL DEFAULT true,
        "auth_dir_slug"               varchar(64)   NULL,
        "phone_number_id"             varchar(64)   NULL,
        "business_account_id"         varchar(64)   NULL,
        "graph_api_version"           varchar(16)   NULL DEFAULT 'v22.0',
        "access_token_enc"            bytea         NULL,
        "access_token_iv"             bytea         NULL,
        "access_token_tag"            bytea         NULL,
        "webhook_verify_token_enc"    bytea         NULL,
        "webhook_verify_token_iv"     bytea         NULL,
        "webhook_verify_token_tag"    bytea         NULL,
        "app_secret_enc"              bytea         NULL,
        "app_secret_iv"               bytea         NULL,
        "app_secret_tag"              bytea         NULL,
        "created_at"                  timestamptz   NOT NULL DEFAULT now(),
        "updated_at"                  timestamptz   NOT NULL DEFAULT now(),
        CONSTRAINT "PK_whatsapp_accounts" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_whatsapp_accounts_phone_e164"
      ON "whatsapp_accounts" ("phone_e164")
      WHERE "phone_e164" IS NOT NULL
    `);

    // Seed the primary Baileys account
    await queryRunner.query(
      `
      INSERT INTO "whatsapp_accounts" ("id", "type", "display_name", "auth_dir_slug", "is_active")
      VALUES ($1, 'baileys', 'Primary', 'primary', true)
      ON CONFLICT ("id") DO NOTHING
      `,
      [PRIMARY_ID],
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "whatsapp_accounts"`);
  }
}
