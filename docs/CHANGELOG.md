# Changelog

All notable changes to Kanabot will be documented in this file.

Format: `[version] — YYYY-MM-DD`

---

## [Unreleased]

### Hostile mob identification — 2026-11-06

- Protect (including Guard) and self-defense fallback targeting now identify hostile mobs by `entity.kind === 'Hostile mobs'`, supporting entity data that uses `type: 'mob'`. Missing or other kinds are excluded; direct retaliation against identified attackers remains unchanged.
- Updated simulated combat fixtures and regression coverage for hostile kinds across entity types and rejection of missing/non-hostile kinds. Live Minecraft compatibility remains unverified.

### External-stance excavation release — 2026-11-05

- Implemented one explicit origin plus directional sizes in chat/tell and dashboard, with read-only previews, 120-second issuer-bound confirmation, idempotent acceptance, scoped stop/status and bounded in-memory history. Legacy coordinate wire actions prepare only; old six-coordinate chat syntax is removed.
- Added conservative flat external walking, verified arrival/retreat, scoped non-destructive pathfinder settings, repeated target/halo/face checks, work deadlines and honest partial/unverified results. No pit entry, ramps, placement or remote survey is included.
- Added version-data-based preferred tool selection through the shared EquipmentService, including harvest tier/durability and post-upkeep reconciliation. Missing preferred tools are reported explicitly.
- Guarded installed digging preparation against cancellation; incoming server block evidence and final stabilization distinguish verified removal from optimistic local air, including across subsequent tasks. Added shared excavation request/plan/status contracts and compact resume projections.
- Added simulated/installed-library regression coverage and updated release boundaries. Live Minecraft compatibility and solid-workload capacity remain unverified.

### Scoped excavation implementation design — 2026-11-05

- Replaced the earlier option catalog with the one-explicit-coordinate-plus-directional-sizes design. Look at two corners is reserved for a future release; other input options are discarded.
- Added API evidence/methodology, request-to-completion and access-retreat diagrams, progressive chunk observation, support-preserving frontier planning, configurable budgets, evidence-based results and concrete development/release gates. Clarified which limits are product policy and which behaviors are library constraints. Documentation only.

### Digging API clarification — 2026-11-05

- Clarified that explicit `lookAt()` is optional and `dig(block, 'ignore')` skips head movement. Qualified the delayed-look cancellation probe: it does not establish ordinary network-stop timing with the stock forced-look implementation. No runtime changes.

### Excavation review and interaction proposal — 2026-11-05

- Added [excavation review and design](EXCAVATION_DESIGN.md), covering current execution risks, source-backed API feasibility, private directional/relative-origin commands, look/support corner selection, conditional arrow capture and an optional participating-server bridge.
- Specified frozen previews, inclusive size/axis rules, issuer-scoped confirmation/cancellation, module boundaries, execution limits and phased verification. All new commands and adapters remain proposals.
- Reproduced an installed-plugin pre-dig cancellation gap, empty-noPath goto resolution and zero-angle cursor rejection using offline fixtures. Reopened the relevant cancellation finding and recorded remaining mutation/observation boundaries. Documentation only; no runtime fix or live-server test is included.

### Task lifecycle and failure-path hardening — 2026-11-05

- Added one transport-independent foreground TaskRuntime/TaskCoordinator contract for Follow, Attack, Protect and excavation. Stop and natural teardown retain ownership until cleanup is confirmed; pending cleanup reports trouble after ten seconds and rejected cleanup blocks successors until retirement.
- Added shared running/stopping/cleanup-failed projection and completed/partial/stopped/failed outcomes to current/resume state. Excavation now supports finite bare-hand selection and reports dug/already-clear/skipped/failed/unvisited counts; partial traversals no longer announce full completion.
- Retain captured Minecraft connections until end confirms termination before retry. Early errors and partial initialization request teardown; late connect/error/greeting callbacks cannot act on replacement or retired sessions.
- Replaced process-wide exception suppression with fatal-error observation that preserves Node's non-zero termination behavior. API/bots still share a process and in-memory sessions are lost on fatal exit; process supervision and worker isolation remain future work.
- Moved deployment retirement controls outside gameplay availability so an attached viewer can retire spawning, dead and disconnected bots. Added simulated runtime, child-process fatal-exit and server-rendered control regressions; live Minecraft/browser/cloud validation remains outstanding.

### Bot Upkeep implementation — 2026-11-04

- Split Idle Behaviors (Fight/Flight, bounded Avoid drowning, Sleep TODO) from opt-in Bot Upkeep (Auto-eat/Auto-armor during or outside tasks), with separate authorized controls/status and event logging.
- Added a shared serialized equipment executor, revisioned generic task item intents, cooperative yields and verified post-meal restoration for Follow, Attack, Protect and excavation. Food policy contains no task-name branches; missing required gear blocks/resumes through bounded readiness retries.
- Replaced runtime armor-plugin automation with toggle-controlled four-slot selection; compatible movement continues and manual removals protect their slots until Auto-armor is disabled/re-enabled or connection replacement.
- Hardened combat look draining, pending cleanup gates and final-block excavation cancellation/terminal cleanup. Manual armor drops compare item metadata/components rather than type alone.
- Added simulated lifecycle, inventory, task-handoff and settings regression coverage; updated architecture, feature docs and diagrams. Real-server/version and load validation remain outstanding.

### Bot Upkeep proposal — 2026-11-04

- Revised the API/source-backed proposal around disjoint, coexisting Idle Behaviors and Bot Upkeep. Upkeep includes only Auto-eat/Auto-armor; Fight/Flight and planned Avoid drowning are idle-only, with Sleep marked TODO.
- Specified why both libraries need an application coordination layer, and defined generic task item requirements with verified post-meal reconciliation for all current/future tasks. Removed the broader candidate catalog. Documentation only; no runtime migration is implemented.

### Hunger telemetry and idle-behavior fixes — 2026-11-04

- Added bot hunger icons and available saturation to the player list, using the existing lazy three-second sampling. Other players' hunger is left unknown.
- Fixed auto-eat remaining permanently unavailable when the controller was created before asynchronous plugin injection. Added clear full-hunger, missing-food and task-pause status; failed meals no longer report completion.
- Hardened player death/despawn during asynchronous combat startup, retained invalid entity references, and prevented automatic reacquisition of respawned players. Added regressions for pending attack/look work and plugin-internal stop rejection handling.
- Added behavior settings, starts, completion/cancellation, target loss and failures to the event log; added hover/active/focus/disabled styling and pointer cursor to the response-settings button.

### Idle behavior controls and Protect notification — 2026-11-04

- Protect now privately tells its protected player when an escort/return path failure or progress timeout stops the task, alongside the existing warning. Navigation failure policy is unchanged.
- Added backend-owned Auto-eat and Self-defense toggles, Fight/Flight mode, configurable fixed response duration, shared status, validation, and deployment-authorized settings updates. Both options default off and run only while idle.
- Integrated pinned mineflayer-auto-eat 5.0.3 with scoped cancellation/listener cleanup and awaited old-item restoration. New tasks interrupt idle work and wait for confirmed resource cleanup; pending synchronous commands return a retry notice.
- Added bounded attacker-based self-defense without gameplay RBAC, held-weapon fallback to flight, death/loss handling, and failed-path suppression for the remaining response window. Unknown attackers never cause guessed retaliation.
- Added installed-library and simulated lifecycle/authorization/notification regression coverage. Design and known compatibility boundaries are documented in IDLE_BEHAVIORS.md.

### Protect implementation — 2026-11-04

- Added modular ProtectTask, cached threat observations, deterministic urgency/retention, bounded chase/return behavior, and structured dashboard status. Hostile mobs only; `!guard` and legacy actions remain compatibility aliases.
- Canonical `task.protect.start` replaces the old grant at role catalog version 2, preserving Crew/Owner authority. Task execution remains independent of RBAC, sockets, and dashboard visibility.
- Added read-only held-weapon readiness. Protect requires an already-held sword/axe for melee; weapon loss interrupts combat and keeps escorting. Automatic weapon selection/equipping remains deferred.
- Scoped PvP compatibility prevents stop-timeout listener deletion and late goal clearing; graceful handoffs have a bounded fallback. Shield automation is disabled during Protect because this plugin version uses fixed metadata and delayed inventory actions.
- Teardown drains owned work and restores settings/listeners before accepting successors. Cleanup trouble is visible and keeps the lease blocked; regression coverage includes installed PvP methods with simulated bots. Real-server combat and load verification remain outstanding.

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
