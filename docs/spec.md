# Kanabot — Technical Specification (MVP)

> Version: 0.2.0  
> Last updated: 2026-11-03

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
- **Bot sessions outlive viewer sockets**: stable IDs identify execution; each socket attaches to one authorized session. Several viewers can attach to the same bot.

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
| No saved bot | BotDeployForm |
| Restoring saved bot | Reconnect status; deployment blocked until resolved |
| `disconnected` existing bot | Existing bot panel and explicit Disconnect Bot control |
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

#### ArmorPanel

- Displayed in the left column whenever the bot session is active (`spawning`, `idle`, `task`, or `dead` state)
- Shows all four armor slots in fixed order: **Head → Torso → Legs → Feet**
- Each row shows a slot icon, slot label, and either the equipped item's `displayName` or a greyed-out "No X" placeholder when empty
- When a slot is occupied, a **Drop** button appears next to the item name; clicking it:
  1. Emits `bot:unequip` (sessionId, slot) to the backend via Socket.IO
  2. Backend calls `bot.unequip(slot)` to move the item to the bot's inventory
  3. Backend then calls `bot.tossStack(item)` to physically drop it in-game
  4. Backend emits a `bot:armor` update; the frontend reflects the change in real time
- Drop buttons are disabled when the bot is not in `idle` or `task` state
- Armor updates are pushed via a dedicated `bot:armor` Socket.IO event emitted on:
  - Initial bot spawn
  - Any `entityEquip` event for `bot.entity`
  - Successful `unequipAndDropArmor()` call

#### PlayerListPanel

- A full-width clickable bar expands a lazy-loaded dropdown, with a searchable server roster and 25 players per page. Collapsing unmounts the list and unsubscribes from roster updates.
- Includes all players exposed by Mineflayer's cached `bot.players`, including players without tracked entities. Servers/proxies may hide or customize that roster.
- Compact Minecraft Tab-style rows place the server-supplied skin head icon (or initial fallback), username, self/bot marker, and health hearts on the left, with labeled icon buttons for actions on the right. A secondary line shows available location, ping, and game mode.
- Displays position/dimension/distance only for currently tracked entities. An untracked player may be far away or in another dimension; no exact remote dimension/location is inferred.
- Displays health only when supplied by Mineflayer's self state, an entity health field, or version-named entity metadata. Health is server-reported, not guaranteed to represent another player's true health. Ten hearts scale to the reported maximum (normally two HP each); the tooltip and accessible label provide the numeric HP. Unknown maximum health is marked with a question mark and uses a reference scale of at least 20 HP; missing health shows a muted heart and question mark.
- `bot:players:subscribe` enables a three-second sampling loop only while the panel is open and the tab is visible. Closing/hiding, death, disconnect, or disposal stops the loop. Unchanged snapshots are suppressed, and rapid toggles reuse a fresh cached snapshot.
- Roster reads do not request new Minecraft packets or force chunk loading. Viewing does not reset the idle timeout.
- Per-player controls: **Whisper**, **Follow**, and **Attack**. Attack has an inline confirmation. Self actions and untrackable follow/attack targets are disabled; creative-mode attacks are rejected. Starting tasks requires idle state and completed cleanup of the previous task.
- Follow and attack use transport-independent modules and shared target/lifecycle checks: tracked entity, same observable dimension, loaded target chunk, 64-block distance cap, path failure/timeout, and a 30-second movement-progress watchdog. Dynamic follow does not continually reset its goal. Scoped pathfinding limits and non-destructive movement settings are restored after cleanup.
- Whispers contain 1–200 characters on one line, use `bot.whisper()`, and do not require the target's entity to be tracked. Whispers can run during other tasks. Command acknowledgement is not a delivery receipt. Sent/received whispers are marked private in the chat mirror.
- Every dashboard command requires an authorized attached viewer. Transport disconnect removes that viewer and its roster interest without ending execution. Accounts and durable sessions are not yet implemented.
- Shared JSON contracts: `shared/playerContracts.d.ts`; backend modules: `backend/src/players/`, `backend/src/tasks/{trackedPlayerTask,followTask,attackTask}.ts`; frontend: `usePlayerList` and `PlayerListPanel`.

#### PlayerRolesPanel and gameplay RBAC

- A deployment-authorized dashboard panel accepts offline or online Minecraft usernames and fixed Visitor/Crew/Owner assignments. Removal restores implicit Visitor access. Assigning Owner atomically transfers the single Owner role.
- Visitor permits follow; Crew inherits follow and adds guard/excavation; Owner inherits Crew and adds attack/stop. Web administrators use their existing separate deployment authority, not a Minecraft identity link.
- `backend/src/access/roleCatalog.ts` defines fixed inherited role grants; `backend/src/commands/taskPermissions.ts` maps operations to permission IDs. `shared/accessContracts.d.ts` defines wire shapes. Assignment maps/revisions live in each BotSession's `PlayerRoleStore`, surviving viewer reconnect but not retirement/backend restart.
- `BotCommandService` validates and authorizes new Minecraft commands before execution. Existing task state is unaffected by assignment changes. There are no task requester/initiator checks or role-driven preemption in RBAC.
- `bot:access:get` and `bot:access:update` require an attached deployment viewer. Updates include username, role (or null), and expected revision; stale revisions return `CONFLICT`. `bot:access` broadcasts updated snapshots to attached viewers. Resume snapshots include access state.
- The role hook/panel does not enable live roster sampling. Permission descriptions come from the backend. Exact chat commands include `!follow`, `!guard`, `!attack`, `!stop`, and `!dig`/`!excavate` with six validated integer coordinates.
- See [BOT_OWNERSHIP_DESIGN.md](BOT_OWNERSHIP_DESIGN.md) for scope, identity limits, module boundaries, and test instructions.

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
- mineflayer-pvp for combat (guard ability)
- mineflayer-armor-manager for automatic armor equipping
- mineflayer-tool for automatic optimal tool selection (excavate ability)

### 4.2 Socket.IO Events

#### Client → Server

| Event | Payload | Description |
|---|---|---|
| `bot:create` | `BotConfig, BotSessionHandle, callback(SessionResult<BotSessionSnapshot>)` | Idempotently create and attach to a bot; same handle does not spawn twice |
| `bot:resume` | `BotSessionHandle, callback(SessionResult<BotSessionSnapshot>)` | Authorize a new viewer and return current state, armor, and bounded history |
| `bot:disconnect` | `sessionId, callback(SessionResult<null>)` | Explicitly stop and retire the attached bot for all viewers |
| `bot:chat` | `sessionId: string, message: string` | Send chat to game |
| `bot:action` | `sessionId: string, action: BotAction` | Issue a task or stop |
| `bot:players:subscribe` | `sessionId, enabled, callback(result)` | Enable/disable the owned session's roster stream |
| `bot:playerAction` | `sessionId, { type: 'follow' \| 'attack' \| 'whisper', target, message? }, callback(result)` | Validated player command; whispers require a message |

#### Server → Client

| Event | Payload | Description |
|---|---|---|
| `bot:state` | `BotSessionInfo` | Full bot state snapshot |
| `bot:removed` | `sessionId` | Bot retired; clear the matching saved handle |
| `bot:chat` | `ChatMessage` | In-game chat event (or system message) |
| `bot:event` | `EventLogEntry` | Lifecycle event for EventLog |
| `bot:error` | `string` | Fatal error message |
| `bot:players` | `{ sessionId, players: ServerPlayer[], updatedAt }` | Changed roster snapshot for an enabled viewer |

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
- `idle → task`: follow, guard, excavation, or attack — **only from idle**, after previous task cleanup
- `task → idle`: `performAction('stop')`
- `any → dead`: mineflayer `death` event
- `any → disconnected`: `disconnect()` or `kicked` event

### 4.5 Bot Abilities

#### Follow

- Uses a single dynamic `mineflayer-pathfinder` `GoalFollow(playerEntity, 3)` in `FollowTask`.
- A shared one-second watchdog validates target availability and progress; it does not reset the movement goal.
- Stops on target loss/death, unloaded chunks, distance limit, dimension change, path failure, or stalled movement. See PlayerListPanel for limits and cleanup semantics.

#### Attack

- Explicit player target handled by `AttackTask`, using `mineflayer-pvp` for approach and combat.
- Equips an available sword/axe, uses the same bounded target/path checks as follow, and supports Stop.
- Task modules use non-destructive movement, own their listeners/timers, await asynchronous startup/cleanup, and restore previous pathfinding/combat settings before new tasks are accepted.
- Server PvP rules still apply; an accepted command is not a guarantee that damage is permitted.

#### Guard

- Runs every 500ms via `mineflayer-pvp`:
  1. Find nearest hostile mob within **5 blocks** of the guarded player
  2. If found: `bot.pvp.attack(mob)` — automatically approaches and attacks the target (movement included)
  3. If none: `bot.pvp.stop()` + `GoalFollow(playerEntity, 3)` — stays within 3 blocks of the guarded player
- Hostile mobs are detected by `entity.type === 'hostile'`
- On guard start: automatically equips the best sword or axe from inventory (see Weapon Manager)
- While guarding: re-evaluates and upgrades weapon whenever the bot picks up a new item

#### Weapon Manager (Guard)

- Triggered on guard start and on every `playerCollect` event where the collector is the bot
- Scans `bot.inventory.items()` for items ending in `sword` or `axe`
- Ranks by material tier: `netherite (6) > diamond (5) > iron (4) > stone (3) > golden (2) > wooden (1)`
- Equips the highest-scoring item to the `hand` slot via `bot.equip(item, 'hand')`
- Listener is registered on guard start and removed on `stopTask()`

#### Armor Manager

- Plugin: `mineflayer-armor-manager`
- Loaded on bot creation via `bot.loadPlugin(armorManager)`
- `bot.armorManager.equipAll()` is called once on the `spawn` event
- Automatically equips the best available armor from inventory into helmet, chestplate, leggings, and boots slots
- No manual intervention required; runs passively whenever the bot's inventory changes

#### Excavate

- Command (in-game chat): `!dig <x1> <y1> <z1> <x2> <y2> <z2>` — two absolute corner coordinates
- Also triggerable from frontend ActionPanel via `bot:action { type: 'excavate', region }`
- Implementation: `ExcavateTask` class in `backend/src/tasks/excavateTask.ts`
- Algorithm:
  1. Normalise coordinates (min/max on each axis)
  2. Reject if total block count exceeds **10,000** (hard safety limit)
  3. Build ordered dig list: Y layers top-down, zigzag XZ within each layer
  4. For each block: navigate within 3 blocks via pathfinder, equip optimal tool via `mineflayer-tool`, call `bot.dig()`
  5. Non-diggable blocks (air, bedrock, barrier) are skipped automatically
  6. If no suitable tool is in inventory, bot digs bare-handed (warning logged, task continues)
  7. Progress milestones at every 10% are emitted to EventLog
  8. On completion: bot chats `"Excavation complete!"` and emits `success` event; transitions back to `idle`
- Cancellation: `!stop` or Stop Task button sets `abortFlag`; running loop exits at next iteration
- New dependency: `mineflayer-tool` — loaded in `BotSession.createBot()` via `bot.loadPlugin(toolPlugin)`

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
| Viewer lifetime | Socket loss/unmount detaches observation; the bot keeps running |
| Bot identity | UUID independent of socket ID; resume requires its secret capability |
| Explicit retirement | Disconnect Bot cancels retries and invalidates all viewers; retired creates cannot replay in this process |
| Roster demand | Sampling continues while at least one attached viewer requests it |

---

## 5. Data Models

```typescript
type BotState = 'disconnected' | 'spawning' | 'idle' | 'task' | 'dead';
type TaskType = 'follow' | 'guard' | 'excavate' | 'attack' | null;

interface BotSessionInfo {
  sessionId: string;
  config: BotConfig;
  state: BotState;
  currentTask: TaskType;
  taskTarget: string | null;
  spawnedAt: string | null; // ISO timestamp
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
- **Local access only**: no user accounts; reattachment requires a 256-bit bearer capability saved in browser storage. Public bot IDs grant no access. This is not a public SaaS identity model.
- **Environment variables**: all config in `.env` (never committed)
- **CORS**: backend restricts origins via `CORS_ORIGIN` env var
- **No persistent storage**: all state is in-memory; restarts clear all sessions

The browser persists one `BotSessionHandle` per origin/backend before create, allowing refresh/navigation and lost-acknowledgement recovery. Resume snapshots retain at most 200 chats and 150 events; tokens are excluded. Shared data/event definitions live in `shared/`. Frontend and backend must be upgraded together for the new lifecycle protocol. See [ARCHITECTURE.md](ARCHITECTURE.md) for lifecycle design and [KNOWN_ISSUES.md](KNOWN_ISSUES.md) for deferred validation, cancellation, client-layer, and armor issues.

---

## 7. Out of Scope (MVP)

- User authentication / login
- Cloud deployment (AWS, GCP, etc.)
- Online-mode bots (Microsoft account auth)
- Multiple bots per user session
- Bot inventory / crafting / farming tasks
- Mobile-optimized UI
- Persistent session history
