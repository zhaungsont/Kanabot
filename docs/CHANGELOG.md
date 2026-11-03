# Changelog

All notable changes to Kanabot will be documented in this file.

Format: `[version] — YYYY-MM-DD`

---

## [Unreleased]

### Design proposals

- Added Protect target-prioritization flowchart and explicit continuous scan/coalescing cadence; clarified which improvements go beyond the existing 333 ms nearest-mob loop. Documentation only.

- Detailed Protect's player-centered 3D distance calculation, API-backed threat evidence/ranking, and transition/terminal teardown inventory, including partial-start failures and delayed plugin cleanup. Documentation only.

- Added detailed Protect overhaul specification covering escort/combat state transitions, threat evidence/ranking, chase limits, lifecycle cleanup, and future player defense under Protect's existing invocation authority.
- Added a separate equipment-module plan. The initial Protect scope includes only a read-only readiness placeholder; automatic equipment selection/mutations and player-threat targeting are deferred. No runtime changes in this documentation update.

### Added

- Gameplay RBAC with fixed inherited Visitor/Crew/Owner grants, a task-permission catalog, and session-scoped username assignments.
- Deployment-authorized Player roles dashboard panel with assignment/removal, atomic Owner transfer, live viewer updates, and refresh retention.
- Command service and exact Minecraft chat parser enforce player permissions independently of task execution; role edits affect new commands and leave existing tasks unchanged.
- Shared access contracts and regression tests for authorization, invalid inputs, assignment conflicts, and role-state broadcasts/resume.

- Browser-independent bot lifecycle: stable IDs, capability-authorized resume, bounded snapshots, and saved browser handles.
- Transport-independent session registry, per-viewer roster subscriptions, shared bot/lifecycle/socket contracts, and lifecycle regression tests.
- `KNOWN_ISSUES.md` tracking deferred architecture findings and confirmed task/armor defects.

- Opt-in player roster with server-provided skin icons, available health/location, search/pagination, and three-second changed-only updates that pause when closed or hidden.
- Private whisper, follow, and confirmed attack controls; private messages are labeled in the chat mirror.
- Transport-independent roster/target/whisper modules and follow/attack tasks with scoped path budgets, chunk/distance checks, target-loss handling, and asynchronous cleanup.
- Shared player contracts and backend regression tests (`npm test` in `backend/`).

### Changed

- Existing follow controls and in-game follow commands use the new follow task module.
- Dashboard commands require an authorized attached viewer. Socket disconnect detaches the viewer; navigation and refresh no longer stop the bot. Explicit Disconnect Bot retires it and cancels pending retries.
- Lifecycle wire protocol changed: create now takes a saved handle and returns a snapshot result; resume is explicit and bot disconnect is acknowledged. Update frontend and backend together; the old socket-owned protocol cannot resume these sessions.
- New tasks wait for previous combat/excavation cleanup; passive looking yields to active tasks.

## [0.2.0] — 2026-05-09

### Changed

**Backend**
- **Guard ability** — reworked using `mineflayer-pvp`; `bot.pvp.attack()` replaces the old `bot.attack()` so the bot now physically chases and fights the target instead of swinging in place
- **Guard detection range** — reduced from 10 → **5 blocks** around the guarded player
- **Guard follow range** — reduced from 5 → **3 blocks** when no threat is nearby
- **Follow range** — corrected to **3 blocks** (was documented as 5)

### Added

**Backend**
- **Weapon Manager** — on guard start, bot scans inventory and equips the highest-tier sword or axe (`netherite > diamond > iron > stone > golden > wooden`); re-evaluates and upgrades automatically on every `playerCollect` event while guarding
- **Armor Manager** — integrated `mineflayer-armor-manager`; `bot.armorManager.equipAll()` is called on every `spawn` event to automatically equip the best available armor

---

## [0.1.0] — 2026-05-08

### Added

**Backend**
- Express + Socket.IO server on port 3001
- `BotManager` — manages all active bot sessions, one per socket connection
- `BotSession` — full bot lifecycle with state machine (`disconnected → spawning → idle ↔ task → dead`)
- mineflayer-pathfinder integration for `follow` and `guard` tasks
- **Follow ability** — bot follows a named player within 5 blocks using `GoalFollow`
- **Guard ability** — bot follows a player and attacks hostile mobs within 10 blocks every 500ms
- **Greet ability** — bot replies "Hi there!" when a player says "hi bot" or "hello bot"
- Idle timeout — auto-disconnect after 10 minutes of inactivity
- Retry logic — up to 5 reconnect attempts with linear backoff on unexpected disconnect
- No retry on kick/ban
- Health check endpoint `GET /health`

**Frontend**
- React 18 + TypeScript + Vite project
- React Router v6 with `/` (Landing) and `/dashboard` routes
- `useBotSession` hook — encapsulates all Socket.IO state and events
- **Landing Page** — product intro with CTA to dashboard
- **Dashboard Page** — full bot control panel
- `BotDeployForm` — server IP, bot name, Minecraft version inputs
- `ChatBox` — real-time in-game chat mirror with send capability
- `EventLog` — terminal-style lifecycle event stream
- `ActionPanel` — Follow / Guard / Stop controls with player name input
- `AdBanner` — placeholder for future Google AdSense integration
- Real-time uptime counter (updates every second)
- Pastel color palette (#FFF7D1, #FFE700) with youth & energy aesthetic

**Project**
- Monorepo structure: `backend/` + `frontend/` + `legacy/`
- `.nvmrc` for Node.js v24.15.0
- `.env.example` for both backend and frontend
- `README.md` with architecture diagram, data flow, and setup instructions
- `spec.md` with full technical specification
- `CHANGELOG.md` (this file)
