import { Column, Entity, Index, PrimaryColumn, UpdateDateColumn } from "typeorm";

@Entity({ name: "chats" })
@Index("idx_chats_last_message", ["lastMessageAt"])
export class Chat {
  @PrimaryColumn("varchar", { length: 512 })
  jid!: string;

  @Column("varchar", { length: 512, nullable: true })
  name?: string | null;

  @Column("boolean", { default: false })
  isGroup!: boolean;

  @Column("varchar", { length: 512, nullable: true })
  lastMessageBody?: string | null;

  @Column("varchar", { length: 64, nullable: true })
  lastMessageType?: string | null;

  @Column("boolean", { nullable: true })
  lastMessageFromMe?: boolean | null;

  @Column("varchar", { length: 256, nullable: true })
  lastSenderName?: string | null;

  @Column("timestamptz", { nullable: true })
  lastMessageAt?: Date | null;

  @Column("int", { default: 0 })
  unreadCount!: number;

  @UpdateDateColumn({ type: "timestamptz" })
  updatedAt!: Date;
}
