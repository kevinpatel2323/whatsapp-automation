import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

export type DeliveryStatus = "accepted" | "sent" | "delivered" | "read" | "failed" | "deleted";

@Entity("message_deliveries")
@Index("idx_delivery_account_jid", ["accountId", "recipientJid"])
export class MessageDelivery {
  @PrimaryColumn("uuid", { name: "account_id" })
  accountId!: string;

  /** The wamid returned by Graph API / received in status webhooks. */
  @PrimaryColumn("varchar", { name: "provider_message_id" })
  providerMessageId!: string;

  @Column("varchar", { name: "recipient_jid", nullable: true })
  recipientJid!: string | null;

  @Column("varchar", { name: "status" })
  status!: DeliveryStatus;

  @Column("timestamptz", { name: "status_at" })
  statusAt!: Date;

  @Column("varchar", { name: "error_code", nullable: true })
  errorCode!: string | null;

  @Column("varchar", { name: "error_title", nullable: true })
  errorTitle!: string | null;

  @Column("text", { name: "error_message", nullable: true })
  errorMessage!: string | null;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
