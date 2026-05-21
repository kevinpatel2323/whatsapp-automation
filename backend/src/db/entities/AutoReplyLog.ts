import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
} from "typeorm";

@Entity({ name: "auto_reply_log" })
@Index("idx_auto_reply_account_cp_sent", ["accountId", "counterpartyJid", "sentAt"])
export class AutoReplyLog {
  @PrimaryGeneratedColumn()
  id!: number;

  @Column("uuid", { name: "account_id" })
  accountId!: string;

  @Column("varchar", { length: 512, name: "counterparty_jid" })
  counterpartyJid!: string;

  @Column("varchar", { length: 128, name: "source_message_id" })
  sourceMessageId!: string;

  @Column("varchar", { length: 512, name: "source_remote_jid" })
  sourceRemoteJid!: string;

  @Column("text", { name: "reply_text" })
  replyText!: string;

  @CreateDateColumn({ type: "timestamptz", name: "sent_at" })
  sentAt!: Date;
}
