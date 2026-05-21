import { Column, Entity, Index, PrimaryColumn, CreateDateColumn } from "typeorm";

@Entity({ name: "messages" })
@Index("idx_messages_account_remote_ts", ["accountId", "remoteJid", "messageTimestampMs"])
export class Message {
  @PrimaryColumn("uuid", { name: "account_id" })
  accountId!: string;

  /** key.id from WhatsApp / wamid from WABA */
  @PrimaryColumn("varchar", { length: 128 })
  id!: string;

  @PrimaryColumn("varchar", { length: 512 })
  remoteJid!: string;

  @PrimaryColumn("boolean", { default: false })
  fromMe!: boolean;

  /** Transport that delivered this message */
  @Column("varchar", { length: 16, default: "baileys" })
  provider!: "baileys" | "waba";

  @Column("varchar", { length: 512, nullable: true })
  participant?: string | null;

  @Column("varchar", { length: 512, nullable: true })
  remoteJidAlt?: string | null;

  @Column("varchar", { length: 512, nullable: true })
  participantAlt?: string | null;

  @Column("varchar", { length: 256, nullable: true })
  pushName?: string | null;

  @Column("varchar", { length: 64 })
  messageType!: string;

  @Column("text", { nullable: true })
  body?: string | null;

  @Column("bigint", { name: "messageTimestamp" })
  messageTimestampMs!: string;

  @Column("jsonb", { name: "raw" })
  rawJson!: Record<string, unknown>;

  /** `buy` | `sell` | `none` — from ticket intent classifier */
  @Column("varchar", { length: 8, nullable: true })
  intent?: string | null;

  @Column("varchar", { length: 64, nullable: true })
  matchedMatch?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
