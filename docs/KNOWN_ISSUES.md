# Known issues and architecture follow-ups

Updated: 2026-11-04. Open items are deferred; inclusion here does not mean a fix has been implemented. Priorities describe impact, not a promised delivery date.

## KI-001 — Command policy and input validation are inconsistent

**Partially addressed · High · Architecture/security**

Gameplay command authorization is implemented through the fixed role catalog and command service. Exact chat parsing, target/coordinate validation, deployment-authorized assignment APIs, and immediate role updates are covered by regression tests. Non-finite/fractional excavation coordinates are rejected. General account authorization, consistent schemas across non-task endpoints, and uniform command outcomes remain follow-ups; TypeScript contracts alone do not validate untrusted data.

Follow-up: extend the implemented command service and validation conventions to future AI/integration adapters and non-task operations. Complete account-scoped authorization and general wire schemas as those capabilities arrive; retain bypass and malformed-input regression coverage.

The [RBAC document](BOT_OWNERSHIP_DESIGN.md) describes the implemented local command boundary and its username identity limits. This does not resolve every endpoint/schema/account concern in KI-001.

The lifecycle change now requires an authorized attached viewer for every dashboard command, including chat, disconnect, and armor. The previously reported cross-session socket ownership gap is therefore addressed; account authorization and shared command policy remain open.

## KI-002 — Excavation cancellation can dig after Stop and retain a stale task

**Resolved · 2026-11-04 · Bot Upkeep prerequisite**

Excavation now checks cancellation after every asynchronous boundary, requests active digging/navigation cancellation, and guarantees one terminal callback in `finally`. Its session cleanup gate stays held until that callback, including on the final block. It also owns death/end/dimension-change observers and removes them on teardown. Regression cases pause final navigation, equipment and digging, issue Stop and resolve late; no new dig starts, exactly one abort is delivered and the task retires. Live server timing still requires validation.

## KI-003 — BotSession combines too many responsibilities

**Partially addressed · Medium · Architecture**

`backend/src/botSession.ts` still manages connection/retry state, armor, telemetry, and task orchestration. Protect has been extracted into independent runtime modules with serialized lifecycle and a read-only equipment port. Follow/attack share `TrackedPlayerTask`; excavation still uses separate callbacks. Shared EquipmentService, cooperative task yields, Bot Upkeep and idle reactions now own equipment coordination; task lifecycle/projection/session responsibilities are still not fully extracted.

Follow-up: extract remaining equipment/armor capabilities, standardize asynchronous task lifecycle/cancellation, and retain a small task coordinator with explicit resource ownership. Keep Mineflayer dependencies inside runtime modules; a wrapper around every library call is unnecessary.

Protect extraction is implemented; [Protect design](PROTECT_DESIGN.md) records its runtime and compatibility constraints. The [equipment foundation](EQUIPMENT_DESIGN.md) now serializes current task/upkeep/manual mutations. Continuous weapon maintenance, richer ranking, projection extraction and uniform task outcomes remain follow-ups. Protect tests use the installed PvP implementation with simulated bots; real-server combat/version validation and many-bot load measurements remain outstanding.

## KI-004 — Frontend client behavior remains embedded in React hooks

**Open · Medium · Architecture**

`frontend/src/hooks/useBotSession.ts` and `usePlayerList.ts` still combine transport, state, subscriptions, and notifications. Components also infer action availability from bot state and game mode. A visual overhaul is contained, but a transport/state-management rewrite would require moving hook logic.

Suggested fix: a framework-independent typed client API/store, thin React adapters, and backend-provided action availability where useful. Keep collapse state, search, pagination, confirmation dialogs, and health formatting in presentation code. The independent backend lifecycle and injected `SessionHandleStore` are completed first steps, not completion of this extraction.

## KI-005 — Runtime schemas and structured outcomes remain incomplete

**Open · Medium · Contracts**

Common data and socket event types now live in `shared/`; `spawnedAt` is an ISO string on the wire. These are compile-time definitions only. Legacy chat/action/armor commands still lack uniform acknowledgements and task progress/results are often human-readable event-log messages. Player commands acknowledge acceptance, not final execution success.

Suggested fix: shared runtime schemas, structured errors and task events, command IDs, and capability-specific retry rules. Tests should cover invalid wire payloads and distinguish acceptance, completion, failure, and unknown outcomes.

## KI-006 — Own armor updates may remain stale

**Partially addressed · Medium · Previously reproduced with a mock**

The armor projection listens to `entityEquip` in `backend/src/botSession.ts`; changes to the bot's own equipment can arrive through inventory slot updates instead. New Upkeep armor upgrades and manual operations explicitly refresh the projection, but arbitrary server-driven breakage/removal may still leave old armor until another refresh. The general slot observer remains deferred.

Suggested fix: observe the relevant inventory slot changes through an armor module, coalesce updates, and test automatic equips as well as manual drops.

## KI-007 — Armor drop can select the wrong copy

**Resolved for distinct copies · 2026-11-04**

Manual removal/drop enters the shared captured-bot inventory lane and matches type, metadata, NBT and components instead of type alone. A regression with a same-type spare carrying different NBT verifies the equipped copy is selected. Identical copies remain interchangeable; there is no persistent Item identity guarantee. A manual removal protects its armor slot from Auto-armor until the toggle is disabled/re-enabled or a new connection is created.

## KI-008 — Local lifecycle foundation is not durable cloud ownership

**Open · Cloud prerequisite · Architecture**

Bots, bounded history, token hashes, and retired-ID replay protection remain in backend memory. Backend restart loses them; API and bot execution still share a process. There are no user accounts, persistent bot definitions, worker leases, or admission limits. Retired IDs accumulate for the process lifetime and need a bounded durable replay strategy before high-volume hosting.

The current dashboard remembers one bot handle per browser origin/backend URL. Tabs sharing that handle can control the same bot; simultaneous first deployment in separate tabs is not a coordinated multi-bot UI. Losing browser storage loses the local access capability. A task can continue without viewers; only idle bots expire automatically.

Suggested fix: implement the account, persistence, runner, quota, and recovery stages in `ARCHITECTURE.md`. Preserve the implemented separation between execution and viewers. Do not expose this local capability mechanism as a complete public SaaS authentication design.

## Completed foundation — browser-independent execution

Implemented 2026-11-03: stable session IDs, authorized reattachment, viewer-only transport disconnect, bounded resume snapshots, per-viewer roster interest, explicit bot retirement, and retry cancellation. Refresh/navigation no longer intentionally destroy execution. See `ARCHITECTURE.md` for the design and limitations.
