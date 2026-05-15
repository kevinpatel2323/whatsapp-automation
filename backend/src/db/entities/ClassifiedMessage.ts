import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryColumn,
} from "typeorm";

@Entity({ name: "classified_messages" })
@Index("idx_cls_match_intent", ["matchedMatch", "intent"])
@Index("idx_cls_remote_ts", ["remoteJid", "messageTimestampMs"])
export class ClassifiedMessage {
  @PrimaryColumn("varchar", { length: 128 })
  messageId!: string;

  @PrimaryColumn("varchar", { length: 512 })
  remoteJid!: string;

  @PrimaryColumn("boolean", { default: false })
  fromMe!: boolean;

  @Column("varchar", { length: 8 })
  intent!: "buy" | "sell" | "none";

  @Column("varchar", { length: 64, nullable: true })
  matchedMatch?: string | null;

  @Column("boolean", { default: false, name: "is_configured_match" })
  isConfiguredMatch!: boolean;

  @Column("varchar", { length: 64, nullable: true })
  matchDate?: string | null;

  @Column("int", { nullable: true })
  quantity?: number | null;

  @Column("jsonb", { default: () => "'[]'" })
  blocks!: string[];

  @Column("jsonb", { default: () => "'[]'" })
  seats!: string[];

  @Column("boolean", { nullable: true })
  sequenceRequired?: boolean | null;

  @Column("varchar", { length: 256, nullable: true })
  sequenceNote?: string | null;

  @Column("jsonb", { default: () => "'[]'" })
  priceHints!: string[];

  @Column("jsonb", { default: () => "'[]'" })
  extraInfo!: string[];

  @Column("varchar", { length: 512, nullable: true })
  rawSnippet?: string | null;

  /** Denormalized message text for list UI */
  @Column("text", { nullable: true })
  body?: string | null;

  @Column("bigint", { name: "messageTimestamp" })
  messageTimestampMs!: string;

  @Column("varchar", { length: 512, nullable: true })
  senderPushName?: string | null;

  @Column("varchar", { length: 512, nullable: true })
  senderParticipant?: string | null;

  @Column("varchar", { length: 512, nullable: true })
  groupJid?: string | null;

  @Column("varchar", { length: 512, nullable: true })
  groupName?: string | null;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;
}
