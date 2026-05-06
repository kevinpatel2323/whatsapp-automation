import { Column, CreateDateColumn, Entity, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "auto_reply_settings" })
export class AutoReplySettings {
  @PrimaryColumn("int", { default: 1 })
  id!: number;

  @Column("boolean", { default: true })
  enabled!: boolean;

  @Column("boolean", { default: true, name: "buy_enabled" })
  buyEnabled!: boolean;

  @Column("boolean", { default: true, name: "sell_enabled" })
  sellEnabled!: boolean;

  /** When true, send on matched match only; buyEnabled/sellEnabled are ignored. */
  @Column("boolean", { default: true, name: "ignore_intent" })
  ignoreIntent!: boolean;

  /** Per canonical match label → reply body. Keys should align with `matches`. */
  @Column("jsonb", { name: "match_replies", default: () => "'{}'" })
  matchReplies!: Record<string, string>;

  /** Canonical labels e.g. ["MI vs CSK", "RCB vs GT"] */
  @Column("text", { array: true, default: "{}" })
  matches!: string[];

  @Column("text", { name: "reply_text" })
  replyText!: string;

  @Column("int", { default: 60, name: "cooldown_minutes" })
  cooldownMinutes!: number;

  /**
   * Never auto-reply to these people. Each item: `name` (label for you) and
   * `value` (phone with country code, or full JID, or LID user id before @).
   */
  @Column("jsonb", { name: "reply_exclusions", default: () => "'[]'" })
  replyExclusions!: Array<{ name: string; value: string }>;

  @CreateDateColumn({ type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
