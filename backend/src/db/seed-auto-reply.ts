import type { DataSource } from "typeorm";
import { config } from "../config.js";
import { AutoReplySettings } from "./entities/AutoReplySettings.js";

export async function seedAutoReplySettingsIfEmpty(dataSource: DataSource) {
  const repo = dataSource.getRepository(AutoReplySettings);
  const existing = await repo.findOne({ where: { id: 1 } });
  if (existing) {
    return;
  }
  const row = repo.create({
    id: 1,
    enabled: config.autoReply.enabled,
    buyEnabled: config.autoReply.buyEnabled,
    sellEnabled: config.autoReply.sellEnabled,
    ignoreIntent: config.autoReply.ignoreIntent,
    matchReplies: { ...config.autoReply.matchReplies },
    matches: config.autoReply.matches,
    replyText: config.autoReply.text,
    cooldownMinutes: config.autoReply.cooldownMinutes,
    replyExclusions: [...(config.autoReply.replyExclusions ?? [])],
  });
  await repo.save(row);
}
