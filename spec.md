# Kanabot — Technical Specification (MVP)

> Version: 0.1.0  
> Last updated: 2026-05-08

---

## 1. Product Overview

Kanabot is a Minecraft-bot-as-a-service platform. Users visit a web dashboard, provide a Minecraft server address and bot name, and the platform spawns an offline-mode Minecraft bot that can follow, guard, and chat inside the game — all controlled from the browser in real time.

---

## 2. System Architecture

### 2.1 Components

| Component | Role |
|---|---|
| Frontend (React + Vite) | Web UI — deploy controls, chat, action panel, event log |
| Backend (Express + Socket.IO) | API server, Socket.IO hub, bot lifecycle manager |
| BotManager | Singleton that tracks all active BotSession instances |
| BotSession | Encapsulates one mineflayer bot: state, abilities, timers |
| Minecraft Server | Third-party game server the bot connects to |

### 2.2 Communication

- **Frontend ↔ Backend**: Socket.IO (WebSocket with HTTP long-poll fallback)
- **Backend ↔ Minecraft**: mineflayer TCP connection
- **One socket connection = one potential bot session** (enforced by BotManager)

---

## 3. Frontend Specification

### 3.1 Routes

| Path | Component | Description |
|---|---|---|
| `/` | LandingPage | Simple landing page with link to dashboard |
| `/dashboard` | DashboardPage | Main bot control panel |

### 3.2 Landing Page

- Minimal design with product name, tagline, and a prominent CTA button → Dashboard.

### 3.3 Dashboard Page

#### States

| Bot State | UI Shown |
|---|---|
| `disconnected` | BotDeployForm only |
| `spawning` | Loading indicator + EventLog |
| `idle` / `task` | ActionPanel + ChatBox + EventLog + Disconnect button |
| `dead` | EventLog + Reconnecting indicator |

#### BotDeployForm

- Required field: **Server IP** (host, supports `host:port` format or separate port field)
- Optional: **Bot Name** (default: `mc_bot`)
- Optional: **Minecraft Version** (blank = auto-detect via mineflayer)
- Submit triggers `bot:create` socket event

#### EventLog

- Terminal-style dark panel (monospace font)
- Displays timestamped entries: `info`, `success`, `warning`, `error`
- Autoscrolls to newest entry
- Shows: spawn success, death, disconnect, task acknowledgements, retry attempts

#### ChatBox

- Mirrors in-game chat in real time
- Displays `[username] message` with timestamps
- Bot messages styled differently (accent color)
- Text input + send button at bottom
- Sends via `bot:chat` socket event

#### ActionPanel

- Available when bot state is `idle` or `task`
- **Follow** button: text input for player name → `bot:action { type: 'follow', target }`
- **Guard** button: text input for player name → `bot:action { type: 'guard', target }`
- **Stop** button: `bot:action { type: 'stop' }` — only shown when bot is in `task` state
- Buttons disabled when bot is in `spawning` or `dead` state

#### AdBanner

- Placeholder `<div>` areas for Google AdSense integration (top and bottom of page)
- Not functional in MVP; reserved for future integration

#### Real-time Uptime Display

- Shows elapsed time since bot spawned (updates every second via `setInterval`)

### 3.4 Color Palette & Design

| Token | Value | Usage |
|---|---|---|
| `--color-bg` | `#FFF7D1` | Page background |
| `--color-accent` | `#FFE700` | Buttons, highlights, borders |
| `--color-accent-dark` | `#E5CC00` | Hover state |
| `--color-surface` | `#FFFAE8` | Card / panel background |
| `--color-terminal` | `#1A1A2E` | EventLog background |
| `--color-terminal-text` | `#E0E0E0` | EventLog default text |
| `--color-success` | `#4CAF50` | Success events |
| `--color-error` | `#FF6B6B` | Error events |
| `--color-warning` | `#FFA500` | Warning events |
| `--color-bot-msg` | `#FFE700` | Bot chat messages |
| `--color-text` | `#2C2C2C` | Body text |

Font: System sans-serif stack. Monospace for EventLog and ChatBox timestamps.

---

## 4. Backend Specification

### 4.1 Stack

- Node.js 24.15.0 (`.nvmrc`)
- TypeScript with ES Modules (`"module": "NodeNext"`)
- Express 4 for HTTP
- Socket.IO 4 for real-time
- mineflayer for Minecraft bot
- mineflayer-pathfinder for bot movement

### 4.2 Socket.IO Events

#### Client → Server

| Event | Payload | Description |
|---|---|---|
| `bot:create` | `BotConfig, callback(sessionId, error?)` | Spawn a new bot |
| `bot:disconnect` | `sessionId: string` | Manually disconnect bot |
| `bot:chat` | `sessionId: string, message: string` | Send chat to game |
| `bot:action` | `sessionId: string, action: BotAction` | Issue a task or stop |

#### Server → Client

| Event | Payload | Description |
|---|---|---|
| `bot:state` | `BotSessionInfo` | Full bot state snapshot |
| `bot:chat` | `ChatMessage` | In-game chat event (or system message) |
| `bot:event` | `EventLogEntry` | Lifecycle event for EventLog |
| `bot:error` | `string` | Fatal error message |

### 4.3 BotConfig Type

```typescript
interface BotConfig {
  serverHost: string;   // Required
  serverPort: number;   // Default: 25565
  botName: string;      // Default: "mc_bot"
  version?: string;     // Optional; blank = mineflayer auto-detect
}
```

### 4.4 BotState Machine

```
disconnected → spawning → idle ↔ task
                                  ↕
                                dead
```

Transitions:
- `disconnected → spawning`: `spawn()` called
- `spawning → idle`: mineflayer `spawn` event fires
- `idle → task`: `performAction('follow' | 'guard', target)` — **only from idle**
- `task → idle`: `performAction('stop')`
- `any → dead`: mineflayer `death` event
- `any → disconnected`: `disconnect()` or `kicked` event

### 4.5 Bot Abilities

#### Follow

- Uses `mineflayer-pathfinder` `GoalFollow(playerEntity, 5)`
- Updates goal every 1 second to track player movement
- Stops if target player leaves the game

#### Guard

- Runs every 500ms:
  1. Find nearest hostile mob within 10 blocks of the guarded player
  2. If found: `bot.attack(mob)`
  3. If none: `GoalFollow(playerEntity, 5)`
- Hostile mob list includes: zombie, skeleton, creeper, spider, cave_spider, witch, enderman, blaze, ghast, slime, magma_cube, piglin_brute, zombified_piglin, husk, stray, phantom, drowned, ravager, pillager, vindicator, evoker, vex, warden, elder_guardian, guardian, silverfish, endermite

#### Basic Greeting

- Triggered by: in-game chat containing `"hi bot"` or `"hello bot"` (case-insensitive)
- Bot replies: `"Hi there!"`
- Works regardless of current task state

### 4.6 Lifecycle Rules

| Rule | Detail |
|---|---|
| Idle timeout | 10 minutes of no user input (no actions, no chat from frontend) → auto-disconnect |
| Retry on unexpected disconnect | Up to 5 attempts with exponential backoff (5s, 10s, 15s, 20s, 25s) |
| No retry on kicked/banned | Session ends immediately |
| One task at a time | `task` state can only be entered from `idle` |
| One bot per socket | BotManager enforces one session per socket connection |

---

## 5. Data Models

```typescript
type BotState = 'disconnected' | 'spawning' | 'idle' | 'task' | 'dead';
type TaskType = 'follow' | 'guard' | null;

interface BotSessionInfo {
  sessionId: string;
  config: BotConfig;
  state: BotState;
  currentTask: TaskType;
  taskTarget: string | null;
  spawnedAt: Date | null;
  uptime: number;         // seconds since spawn
}

interface ChatMessage {
  username: string;
  message: string;
  timestamp: number;      // Unix ms
  isBot?: boolean;        // true for bot/system messages
}

interface EventLogEntry {
  type: 'info' | 'success' | 'warning' | 'error';
  message: string;
  timestamp: number;      // Unix ms
}
```

---

## 6. Security & Constraints

- **Offline mode only**: bots use `auth: 'offline'` — no Microsoft accounts in MVP
- **No authentication**: dashboard is publicly accessible in MVP
- **Environment variables**: all config in `.env` (never committed)
- **CORS**: backend restricts origins via `CORS_ORIGIN` env var
- **No persistent storage**: all state is in-memory; restarts clear all sessions

---

## 7. Out of Scope (MVP)

- User authentication / login
- Cloud deployment (AWS, GCP, etc.)
- Online-mode bots (Microsoft account auth)
- Multiple bots per user session
- Bot inventory / crafting / farming tasks
- Mobile-optimized UI
- Persistent session history
