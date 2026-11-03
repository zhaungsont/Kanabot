# Known issues and architecture follow-ups

Updated: 2026-11-03. Open items are deferred; inclusion here does not mean a fix has been implemented. Priorities describe impact, not a promised delivery date.

## KI-001 — Command policy and input validation are inconsistent

**Partially addressed · High · Architecture/security**

Gameplay command authorization is implemented through the fixed role catalog and command service. Exact chat parsing, target/coordinate validation, deployment-authorized assignment APIs, and immediate role updates are covered by regression tests. Non-finite/fractional excavation coordinates are rejected. General account authorization, consistent schemas across non-task endpoints, and uniform command outcomes remain follow-ups; TypeScript contracts alone do not validate untrusted data.

Follow-up: extend the implemented command service and validation conventions to future AI/integration adapters and non-task operations. Complete account-scoped authorization and general wire schemas as those capabilities arrive; retain bypass and malformed-input regression coverage.

The [RBAC document](BOT_OWNERSHIP_DESIGN.md) describes the implemented local command boundary and its username identity limits. This does not resolve every endpoint/schema/account concern in KI-001.

The lifecycle change now requires an authorized attached viewer for every dashboard command, including chat, disconnect, and armor. The previously reported cross-session socket ownership gap is therefore addressed; account authorization and shared command policy remain open.

## KI-002 — Excavation cancellation can dig after Stop and retain a stale task

**Open · High · Confirmed with a deterministic mock**

In `backend/src/tasks/excavateTask.ts`, pause `equipForBlock()` on the final block, call `abort()`, then resolve equipment selection. Execution can still call `dig()`. The loop then exits without calling either `onAbort` or `onComplete`. `BotSession.activeExcavateTask` remains set: the public state is idle, but the next task is rejected as still stopping.

Suggested fix: cancellation checks after every asynchronous boundary, active digging cancellation, and guaranteed terminal cleanup in `finally`. Regression coverage must exercise cancellation during navigation, equipment selection, and digging, including the final block. This bug was deliberately not fixed in the dashboard-lifecycle change.

## KI-003 — BotSession combines too many responsibilities

**Open · Medium · Architecture**

`backend/src/botSession.ts` manages connection/retry state, command parsing, guard behavior, equipment, armor, telemetry, and task orchestration. Follow/attack share `TrackedPlayerTask`, excavation uses separate callbacks, and guard remains inline. Equipment and armor operations can overlap task-owned inventory operations.

Suggested fix: extract guard and equipment capabilities, standardize asynchronous task lifecycle/cancellation, and retain a small task coordinator with explicit resource ownership. Keep Mineflayer dependencies inside runtime modules; a wrapper around every library call is unnecessary.

Detailed proposals: [Protect overhaul](PROTECT_DESIGN.md) and [equipment follow-up](EQUIPMENT_DESIGN.md). Both await approval. The planned Protect implementation includes only a read-only equipment interface/placeholder; the actual equipping module and migration of other inventory paths remain separately deferred.

## KI-004 — Frontend client behavior remains embedded in React hooks

**Open · Medium · Architecture**

`frontend/src/hooks/useBotSession.ts` and `usePlayerList.ts` still combine transport, state, subscriptions, and notifications. Components also infer action availability from bot state and game mode. A visual overhaul is contained, but a transport/state-management rewrite would require moving hook logic.

Suggested fix: a framework-independent typed client API/store, thin React adapters, and backend-provided action availability where useful. Keep collapse state, search, pagination, confirmation dialogs, and health formatting in presentation code. The independent backend lifecycle and injected `SessionHandleStore` are completed first steps, not completion of this extraction.

## KI-005 — Runtime schemas and structured outcomes remain incomplete

**Open · Medium · Contracts**

Common data and socket event types now live in `shared/`; `spawnedAt` is an ISO string on the wire. These are compile-time definitions only. Legacy chat/action/armor commands still lack uniform acknowledgements and task progress/results are often human-readable event-log messages. Player commands acknowledge acceptance, not final execution success.

Suggested fix: shared runtime schemas, structured errors and task events, command IDs, and capability-specific retry rules. Tests should cover invalid wire payloads and distinguish acceptance, completion, failure, and unknown outcomes.

## KI-006 — Own armor updates may remain stale

**Open · Medium · Previously reproduced with a mock**

The armor projection listens to `entityEquip` in `backend/src/botSession.ts`; changes to the bot's own equipment can arrive through inventory slot updates instead. The dashboard may retain old armor until another explicit refresh.

Suggested fix: observe the relevant inventory slot changes through an armor module, coalesce updates, and test automatic equips as well as manual drops.

## KI-007 — Armor drop can select the wrong copy

**Open · Medium · Previously reproduced with a mock**

After unequipping, `unequipAndDropArmor()` locates an inventory item by item type alone. With multiple copies, it can toss a spare with different enchantments, durability, or metadata.

Suggested fix: track the unequipped item's identity/metadata and resulting slot, coordinate inventory operations, and test two same-type items with different properties.

## KI-008 — Local lifecycle foundation is not durable cloud ownership

**Open · Cloud prerequisite · Architecture**

Bots, bounded history, token hashes, and retired-ID replay protection remain in backend memory. Backend restart loses them; API and bot execution still share a process. There are no user accounts, persistent bot definitions, worker leases, or admission limits. Retired IDs accumulate for the process lifetime and need a bounded durable replay strategy before high-volume hosting.

The current dashboard remembers one bot handle per browser origin/backend URL. Tabs sharing that handle can control the same bot; simultaneous first deployment in separate tabs is not a coordinated multi-bot UI. Losing browser storage loses the local access capability. A task can continue without viewers; only idle bots expire automatically.

Suggested fix: implement the account, persistence, runner, quota, and recovery stages in `ARCHITECTURE.md`. Preserve the implemented separation between execution and viewers. Do not expose this local capability mechanism as a complete public SaaS authentication design.

## Completed foundation — browser-independent execution

Implemented 2026-11-03: stable session IDs, authorized reattachment, viewer-only transport disconnect, bounded resume snapshots, per-viewer roster interest, explicit bot retirement, and retry cancellation. Refresh/navigation no longer intentionally destroy execution. See `ARCHITECTURE.md` for the design and limitations.
