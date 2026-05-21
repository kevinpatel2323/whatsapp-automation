import type { DataSource } from "typeorm";
import { PRIMARY_BAILEYS_ACCOUNT_ID } from "../config.js";
import { WhatsAppAccount } from "./entities/WhatsAppAccount.js";

/**
 * Insert the primary Baileys account row if missing. Migration 001 also seeds
 * this row, but when bootstrap uses TYPEORM_SYNC instead of migrations the row
 * never gets inserted — so we re-seed here on every boot.
 */
export async function seedPrimaryBaileysIfMissing(dataSource: DataSource): Promise<void> {
  const repo = dataSource.getRepository(WhatsAppAccount);
  const existing = await repo.findOneBy({ id: PRIMARY_BAILEYS_ACCOUNT_ID });
  if (existing) return;
  const row = new WhatsAppAccount();
  row.id = PRIMARY_BAILEYS_ACCOUNT_ID;
  row.type = "baileys";
  row.displayName = "Primary";
  row.authDirSlug = "primary";
  row.isActive = true;
  await repo.save(row);
}
