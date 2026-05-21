import { DataSource } from "typeorm";
import { config } from "../config.js";
import {
  AutoReplyLog,
  AutoReplySettings,
  Chat,
  ClassifiedMessage,
  Message,
  MessageDelivery,
  MessageTemplate,
  WhatsAppAccount,
} from "./entities/index.js";
import { CreateWhatsappAccounts1700000000001 } from "../migrations/001_CreateWhatsappAccounts.js";
import { AddAccountId1700000000002 } from "../migrations/002_AddAccountId.js";
import { AddTemplatesAndDeliveries1700000000003 } from "../migrations/003_AddTemplatesAndDeliveries.js";

const wantSsl = process.env.DATABASE_SSL === "true" || process.env.DATABASE_SSL === "require";

const dataSource = new DataSource({
  type: "postgres",
  url: config.databaseUrl,
  entities: [Chat, Message, ClassifiedMessage, AutoReplySettings, AutoReplyLog, WhatsAppAccount, MessageTemplate, MessageDelivery],
  logging: false,
  synchronize: config.typeormSync,
  migrations: [CreateWhatsappAccounts1700000000001, AddAccountId1700000000002, AddTemplatesAndDeliveries1700000000003],
  migrationsTableName: "typeorm_migrations",
  migrationsRun: process.env.RUN_MIGRATIONS === "true",
  ssl: wantSsl ? { rejectUnauthorized: false } : false,
  extra: {
    max: 8,
  },
});

export { dataSource };

export async function initDataSource() {
  if (!dataSource.isInitialized) {
    await dataSource.initialize();
  }
  return dataSource;
}
