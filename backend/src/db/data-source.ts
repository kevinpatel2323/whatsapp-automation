import { DataSource } from "typeorm";
import { config } from "../config.js";
import { AutoReplyLog, AutoReplySettings, Chat, Message } from "./entities/index.js";

const dataSource = new DataSource({
  type: "postgres",
  url: config.databaseUrl,
  entities: [Chat, Message, AutoReplySettings, AutoReplyLog],
  logging: false,
  synchronize: config.typeormSync,
  migrations: [],
  migrationsTableName: "typeorm_migrations",
  ssl: false,
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
