import 'dotenv/config';

import './runtime/processSafety.js';

import express from 'express';
import { createServer } from 'http';
import { Server } from 'socket.io';
import cors from 'cors';
import { BotManager } from './botManager.js';
import { registerAccessHandlers } from './access/accessHandlers.js';
import { registerSessionHandlers } from './sessions/sessionHandlers.js';
import { registerPlayerHandlers } from './players/playerHandlers.js';
import {
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
  registerPlayerHandlers(socket, botManager);
  registerAccessHandlers(socket, botManager);

  registerSessionHandlers(socket, botManager);
});

// ─── Start Server ─────────────────────────────────────────────────────────────

httpServer.listen(PORT, () => {
  console.log(`[Kanabot] Backend running on http://localhost:${PORT}`);
  console.log(`[Kanabot] CORS origin: ${CORS_ORIGIN}`);
});
