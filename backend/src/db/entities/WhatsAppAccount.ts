import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity({ name: "whatsapp_accounts" })
export class WhatsAppAccount {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  /** 'baileys' or 'waba' */
  @Column("varchar", { length: 16 })
  type!: "baileys" | "waba";

  @Column("varchar", { length: 128, name: "display_name" })
  displayName!: string;

  /** E.164 digits, populated after first successful connect */
  @Column("varchar", { length: 20, nullable: true, name: "phone_e164", unique: true })
  phoneE164?: string | null;

  @Column("boolean", { default: true, name: "is_active" })
  isActive!: boolean;

  /** Baileys: subdirectory name under backend/auth_info/<slug>/ */
  @Column("varchar", { length: 64, nullable: true, name: "auth_dir_slug" })
  authDirSlug?: string | null;

  /** WABA: Meta phone number ID */
  @Column("varchar", { length: 64, nullable: true, name: "phone_number_id" })
  phoneNumberId?: string | null;

  /** WABA: Meta business account ID */
  @Column("varchar", { length: 64, nullable: true, name: "business_account_id" })
  businessAccountId?: string | null;

  @Column("varchar", { length: 16, nullable: true, name: "graph_api_version", default: "v22.0" })
  graphApiVersion?: string | null;

  /** AES-256-GCM encrypted WABA access token */
  @Column("bytea", { nullable: true, name: "access_token_enc" })
  accessTokenEnc?: Buffer | null;

  @Column("bytea", { nullable: true, name: "access_token_iv" })
  accessTokenIv?: Buffer | null;

  @Column("bytea", { nullable: true, name: "access_token_tag" })
  accessTokenTag?: Buffer | null;

  @Column("bytea", { nullable: true, name: "webhook_verify_token_enc" })
  webhookVerifyTokenEnc?: Buffer | null;

  @Column("bytea", { nullable: true, name: "webhook_verify_token_iv" })
  webhookVerifyTokenIv?: Buffer | null;

  @Column("bytea", { nullable: true, name: "webhook_verify_token_tag" })
  webhookVerifyTokenTag?: Buffer | null;

  @Column("bytea", { nullable: true, name: "app_secret_enc" })
  appSecretEnc?: Buffer | null;

  @Column("bytea", { nullable: true, name: "app_secret_iv" })
  appSecretIv?: Buffer | null;

  @Column("bytea", { nullable: true, name: "app_secret_tag" })
  appSecretTag?: Buffer | null;

  @CreateDateColumn({ type: "timestamptz", name: "created_at" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz", name: "updated_at" })
  updatedAt!: Date;
}
