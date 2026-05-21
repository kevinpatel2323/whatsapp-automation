import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from "typeorm";

@Entity("message_templates")
@Index("idx_template_account_status", ["accountId", "status"])
@Index("UQ_template_account_name_lang", ["accountId", "name", "language"], { unique: true })
export class MessageTemplate {
  @PrimaryGeneratedColumn("uuid")
  id!: string;

  @Column("uuid", { name: "account_id" })
  accountId!: string;

  @Column("varchar", { name: "meta_template_id", nullable: true })
  metaTemplateId!: string | null;

  @Column("varchar")
  name!: string;

  @Column("varchar")
  language!: string;

  @Column("varchar")
  category!: string;

  /** APPROVED | PENDING | REJECTED | DELETED */
  @Column("varchar")
  status!: string;

  /** Raw components JSON from Meta. */
  @Column("jsonb", { name: "components_json", nullable: true })
  componentsJson!: object | null;

  /** Derived placeholder slots (e.g. ["1","2"]) for UX. */
  @Column("jsonb", { name: "placeholders_json", nullable: true })
  placeholdersJson!: string[] | null;

  @Column("timestamptz", { name: "last_synced_at", nullable: true })
  lastSyncedAt!: Date | null;

  @CreateDateColumn({ name: "created_at", type: "timestamptz" })
  createdAt!: Date;

  @UpdateDateColumn({ name: "updated_at", type: "timestamptz" })
  updatedAt!: Date;
}
