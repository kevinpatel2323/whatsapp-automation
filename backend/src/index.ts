import "reflect-metadata";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import cors from "cors";
import express from "express";
import { Server } from "socket.io";
import pino from "pino";
import { config } from "./config.js";
import { initDataSource } from "./db/data-source.js";
import { seedAutoReplySettingsIfEmpty } from "./db/seed-auto-reply.js";
import { createSocketGateway } from "./realtime/socket.gateway.js";
import { createAutoReplyService } from "./whatsapp/auto-reply.service.js";
import { createBaileysService } from "./whatsapp/baileys.service.js";
import { mountApi } from "./api/routes.js";

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
  const dataSource = await initDataSource();
  await seedAutoReplySettingsIfEmpty(dataSource);
  const app = express();
  app.use(
    cors({
      origin: true,
      credentials: true,
    }),
  );
  app.use(express.json());

  const httpServer = createServer(app);
  const io = new Server(httpServer, {
    cors: { origin: true, credentials: true, methods: ["GET", "POST"] },
  });

  const emit = createSocketGateway(io);

  const waRef: {
    s: ReturnType<typeof createBaileysService> | null;
  } = { s: null };
  const autoReply = createAutoReplyService({
    dataSource,
    getSocket: () => waRef.s?.getSocket() ?? null,
    getUserJid: () => waRef.s?.getUserJid(),
    emit,
  });
  waRef.s = createBaileysService({ dataSource, emit, autoReply });
  const wa = waRef.s;

  mountApi(app, { wa, dataSource, autoReply, emit });

  app.get("/health", (_q, res) => {
    res.json({ ok: true, status: wa.getStatus() });
  });

  httpServer.listen(config.port, () => {
    log.info({ port: config.port, cors: "all origins" }, "API + Socket.io listening");
  });
}

void main().catch((e) => {
  log.error(e, "Fatal");
  process.exit(1);
});
