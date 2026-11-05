# Local task lifecycle and ownership

Implemented 2026-11-05. Follow, Attack, Protect and excavation share the transport-independent `TaskRuntime` contract in [taskRuntime.ts](../backend/src/tasks/taskRuntime.ts). This is an in-process execution contract, not a durable cloud command protocol.

The [excavation review](EXCAVATION_DESIGN.md#implemented-first-release) reproduced a conditional library-internal pre-dig cancellation gap using a deliberately deferred look. The executor now guards that internal await and installed-library regressions verify cancellation before startup sends no dig packet. The shared lease remains necessary to drain owned work; it does not itself make arbitrary plugins cancellation-aware. Stock forced look does not wait for gradual rotation; live timing still requires acceptance testing.

## Responsibilities

- `start()` starts owned work. Its promise can describe startup or the whole operation; callers use `completion` for the terminal result, never the return of `start()` as a completion signal.
- `stop()` invalidates new work immediately, drains startup, upkeep handoffs and plugin operations, and restores acquired listeners/settings. Repeated stops share the same drain. Successful return confirms cleanup; rejection means ownership remains uncertain.
- `cleanupStarted` reports both automatic and requested teardown. `completion` settles exactly once after cleanup. A resolved `TaskOutcome` distinguishes completed, partial, stopped and failed execution. Cleanup failure rejects completion instead of reporting a successful release.
- Each task implements `EquipmentOwner`, publishes its current hand requirement, and yields at safe points. A yielded task retains its foreground slot; idle reactions cannot take over.

The [TaskCoordinator](../backend/src/tasks/taskCoordinator.ts) owns one foreground lease without importing task classes, Mineflayer, Socket.IO, React or RBAC. It admits no successor until completion confirms cleanup, including after natural failure. After ten seconds of pending cleanup it publishes trouble but keeps ownership. A late confirmed drain can release that pending lease; rejected cleanup requires deployment retirement. Late startup errors from previous owners cannot stop a successor.

BotSession composes concrete tasks, checks commands/targets, and projects coordinator state. It has no task-type-specific stop branch. All task kinds remain in `task` while stopping; a living connection becomes `idle` only after confirmed release. Death and disconnect keep their lifecycle state when late task cleanup finishes. Shared `BotSessionInfo.taskLifecycle` exposes running/stopping/cleanup-failed details; `lastTaskOutcome` holds the latest terminal result until another task starts. Both are ephemeral and included in resume snapshots. Task notifications and summaries do not provide command IDs, durable delivery or replay protection.

## Excavation results

Excavation counts `total`, verified `dug`, `alreadyClear`, `skipped` (blocked/unknown), `failed`, `unverified` and `unvisited`, with bounded reason counts and return-to-staging status. Missing data never becomes clear. Incoming server block packets distinguish verified removal from optimistic local air; unverified cells remain unknown across later jobs on that connection. Final stabilization/scan and verified return are required for completion. Cancellation reports stopped and never starts an automatic return. Failed cleanup retains the gate and is reflected in excavation status. Terminal Minecraft feedback is private.

The `excavation` equipment policy requires the current version's preferred tool and harvest tier, including usable durability. Hands are valid only for materials with no preferred tool that can be hand-harvested. Selecting an empty hand uses a verified empty hotbar slot, never an item drop. Food restoration reconciles that same live policy; the executor verifies it again immediately before digging and after internal look preparation.

## Connection and process failure boundaries

[BotConnection](../backend/src/runtime/botConnection.ts) retains its captured bot until `end` confirms termination. Early spawning errors cancel connection-scoped timers and request closure. After 1.5 seconds a pending connection is force-closed where possible; lack of `end` reports unconfirmed termination and blocks automatic replacement. Late connect callbacks still close canceled connections. The existing five linear retry delays begin only after confirmed end. Retirement invalidates pending retries even if end arrives later; retirement acknowledgement accepts the stop request and is not a Minecraft delivery receipt.

Unexpected uncaught exceptions and unhandled rejections terminate the backend with Node's non-zero failure behavior. The process monitor only records a diagnostic. Expected network errors are handled by the owning bot. API and bot execution still share a process, so a fatal failure loses in-memory sessions; production supervision and independent worker processes remain proposed in [ARCHITECTURE.md](ARCHITECTURE.md).

## Verification

Simulated tests cover failed/pending cleanup, partial startup, cancellation during final navigation/equipment/digging, end-confirmed connection replacement, late callbacks, retirement/retry cancellation, excavation summaries, preferred-tool shortages, server evidence and non-destructive installed-pathfinder routes. Child-process tests verify fatal exit behavior. Server-rendered UI tests check retirement controls across all bot states; they do not prove browser interaction or gameplay compatibility. Run the backend regression suite and both application builds with the Node version in `backend/.nvmrc`.
