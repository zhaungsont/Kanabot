import 'dotenv/config';

// ─── Process-level safety net ─────────────────────────────────────────────────
// Prevent raw unhandled errors (e.g. ECONNRESET from mineflayer internals)
// from crashing the server or printing noisy stack traces.
process.on('uncaughtException', (err: Error & { code?: string }) => {
  const benign = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'ETIMEDOUT', 'EPIPE'];
  if (err.code && benign.includes(err.code)) {
    console.warn(`[Process] Swallowed network error: ${err.code} — ${err.message}`);
  } else {
    console.error('[Process] Uncaught exception:', err);
  }
});

process.on('unhandledRejection', (reason) => {
  console.error('[Process] Unhandled rejection:', reason);
});

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { BotManager } from './botManager.js';
import {
  BotConfig,
  BotAction,
  ServerToClientEvents,
  ClientToServerEvents,
  InterServerEvents,
  SocketData,
} from './types.js';

const PORT = parseInt(process.env['PORT'] ?? '3001', 10);
const CORS_ORIGIN = process.env['CORS_ORIGIN'] ?? 'http://localhost:5173';

const app = express();
app.use(cors({ origin: CORS_ORIGIN }));
app.use(express.json());

const httpServer = createServer(app);
const io = new Server<ClientToServerEvents, ServerToClientEvents, InterServerEvents, SocketData>(
  httpServer,
  { cors: { origin: CORS_ORIGIN, methods: ['GET', 'POST'] } }
);

const botManager = new BotManager();

// ─── HTTP Routes ──────────────────────────────────────────────────────────────

app.get('/health', (_req, res) => {
  res.json({ status: 'ok', activeBots: botManager.sessionCount });
});

// ─── Socket.IO ────────────────────────────────────────────────────────────────

io.on('connection', (socket) => {
  console.log(`[Socket] Connected: ${socket.id}`);

  socket.on('bot:create', (config: BotConfig, callback) => {
    if (!config.serverHost) {
      callback(null, 'Server host is required.');
      return;
    }

    try {
      const normalizedConfig: BotConfig = {
        serverHost: config.serverHost.trim(),
        serverPort: config.serverPort || undefined,
        botName: config.botName?.trim() || 'mc_bot',
        version: config.version?.trim() || undefined,
      };

      const { sessionId, session } = botManager.createSession(socket, normalizedConfig);
      session.spawn();
      callback(sessionId);
    } catch (err) {
      console.error('[BotCreate] Error:', err);
      callback(null, String(err));
    }
  });

  socket.on('bot:disconnect', (sessionId: string) => {
    const session = botManager.getSession(sessionId);
    session?.disconnect();
  });

  socket.on('bot:chat', (sessionId: string, message: string) => {
    const session = botManager.getSession(sessionId);
    if (!session) return;
    session.sendChat(message);
    session.resetIdleTimer();
  });

  socket.on('bot:action', (sessionId: string, action: BotAction) => {
    const session = botManager.getSession(sessionId);
    if (!session) return;
    session.performAction(action.type, action.target);
    session.resetIdleTimer();
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Disconnected: ${socket.id}`);
    botManager.destroyBySocketId(socket.id);
  });
});

// ─── Start Server ─────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[Kanabot] Backend running on http://localhost:${PORT}`);
  console.log(`[Kanabot] CORS origin: ${CORS_ORIGIN}`);
});
