import "reflect-metadata";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import pino from "pino";
import { config, PRIMARY_BAILEYS_ACCOUNT_ID } from "./config.js";
import { initDataSource } from "./db/data-source.js";
import { seedAutoReplySettingsIfEmpty } from "./db/seed-auto-reply.js";
import { seedPrimaryBaileysIfMissing } from "./db/seed-baileys.js";
import { createSocketGateway } from "./realtime/socket.gateway.js";
import { createAutoReplyService } from "./whatsapp/auto-reply.service.js";
import { createClassificationService } from "./whatsapp/classification.service.js";
import { ConnectionRegistry } from "./whatsapp/connection-registry.js";
import { migrateLegacyAuthInfo } from "./whatsapp/baileys.service.js";
import { mountApi } from "./api/routes.js";
import { mountWebhooks } from "./api/webhooks.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({ path: path.join(__dirname, "../../.env") });
dotenv.config({ path: path.join(__dirname, "../.env") });
dotenv.config();

const log = pino({
  level: "info",
  transport:
    process.env.NODE_ENV === "development"
      ? { target: "pino-pretty", options: { colorize: true } }
      : undefined,
});

async function main() {
  // Move legacy auth_info/*.json → auth_info/primary/ before connecting
  await migrateLegacyAuthInfo("primary");

  const dataSource = await initDataSource();
  await seedPrimaryBaileysIfMissing(dataSource);
  await seedAutoReplySettingsIfEmpty(dataSource);

  const app = express();
  app.use(cors({ origin: true, credentials: true }));

  // WABA webhooks must use raw body (HMAC needs it) — mount BEFORE express.json()
  const webhookRouter = express.Router();
  app.use("/api/webhooks", express.raw({ type: "application/json" }), webhookRouter);

  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    path: process.env.SOCKETIO_PATH ?? "/socket.io/",
    cors: { origin: true, credentials: true, methods: ["GET", "POST"] },
  });

  const emit = createSocketGateway(io);
  const autoReply = createAutoReplyService({ dataSource, emit });
  const classification = createClassificationService({ autoReply });

  const registry = new ConnectionRegistry({ dataSource, emit, autoReply, classification });
  await registry.loadActive();

  // Late-bind registry into autoReply so routing can dispatch via non-primary accounts
  autoReply.setGetConnection((accountId) => registry.getByAccountId(accountId));

  // Backward-compat alias: primary connection for legacy API paths
  const primaryConn = registry.getPrimary();

  mountWebhooks({ router: webhookRouter, registry, dataSource, emit, autoReply, classification });
  mountApi(app, { registry, primaryConn, dataSource, autoReply, emit });

  app.get("/health", (_q, res) => {
    res.json({ ok: true, accounts: registry.list() });
  });

  httpServer.listen(config.port, () => {
    log.info(
      { port: config.port, primaryAccountId: PRIMARY_BAILEYS_ACCOUNT_ID },
      "API + Socket.io listening",
    );
  });
}

void main().catch((e) => {
  log.error(e, "Fatal");
  process.exit(1);
});
