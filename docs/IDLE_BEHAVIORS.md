# Automatic idle behaviors

Status: implemented local runtime, 2026-11-04. Settings and execution belong to the backend BotSession; no browser connection is needed after configuration. This adds optional idle behaviors without changing Protect's navigation failure policy or the task scheduler.

## Controls and scope

Both options default off. The dashboard's **Automatic behaviors** panel offers Auto-eat and Self-defense, with Fight/Flight selection and a **Response duration** of 1–120 whole seconds (default 10). Settings survive dashboard refresh and Minecraft reconnect/respawn in the same session. Retirement/backend restart discards them. Concurrent viewer edits use last accepted write, with authoritative state broadcast to all viewers.

Only an authenticated attached deployment viewer can change settings via `bot:behaviors:update`. Automatic execution has no requester and never calls gameplay RBAC. It cannot be enabled or configured through Minecraft chat. Player-role edits do not affect it.

## Runtime boundaries and ownership

- `backend/src/behaviors/settings.ts`: defaults, copies and runtime validation.
- `IdleBehaviors`: one per Minecraft connection; observes self damage and schedules idle eating, owns cancellation and published status.
- `SelfDefenseReaction`: bounded combat/flight response, owned pathfinding settings/listeners/timers.
- `AutoEatAdapter`: installed library integration, consumption cancellation/listener cleanup and awaited item restoration.
- `backend/src/runtime/combatAdapter.ts`: exclusive scoped PvP compatibility lease, shared with Protect. The old Protect import re-exports the same class.
- `shared/behaviorContracts.d.ts`: JSON configuration/status; UI components only render it and submit settings.

Eligibility requires session state idle, no current task, no task cleanup, and no manual inventory operation. Idle glances pause while a behavior owns execution. Behaviors never interrupt an active Follow, Protect, Attack or excavation task. A new task request interrupts an idle behavior; because command acceptance remains synchronous, it is rejected with a retry message until asynchronous cleanup settles. No task is silently queued. Stop also interrupts idle behavior. Manual armor actions use the same cleanup gate.

Behavior activity is separate from `currentTask`: idle/eating/defending/stopping/cleanup-failed. It does not change gameplay task permissions. Existing ten-minute idle retirement still applies; automation does not renew it. General coordination of legacy automatic armor, Attack and mining equipment is still deferred.

## Auto-eat

Uses the user-requested `mineflayer-auto-eat` **5.0.3**, pinned because its adapter has version-specific compatibility hooks. The plugin selects and equips food and performs consumption. Kanabot schedules its public `eat()` method rather than enabling an unrestricted physics-tick loop: initialize the adapter lazily after Mineflayer injects the plugin, then check once per second while idle, with a five-second pause after an attempt. Eat at or below 15 hunger, or below 14 health when hunger is not full. Full hunger does not allow ordinary food consumption; healing then depends on server regeneration rules or special items. The status distinguishes plugin initialization, missing hunger data, full hunger, missing food and task pauses. Retain the plugin's banned-food policy. No food is created or acquired automatically. Missing-food/eating failures log at most once per 30 seconds. Starts, completion/cancellation, setting changes, self-defense transitions and target loss are also recorded with appropriate event-log severity. Failed meals never emit a success event.

Auto-eat pauses during tasks and self-defense. An identified attack cancels/drains eating before starting defense; time spent draining counts toward the response duration. The adapter disables upstream's fire-and-forget old-item restoration and awaits its own restoration when the original held item is still present. It does not select better weapons or implement the deferred equipment overhaul.

### Installed-library compatibility

Inspection of installed 5.0.3 found that its consumption timeout leaves listeners installed, cancellation may occur before its consumption wait exists, equip failure may leave `isEating` true, and default item restoration is not awaited. The adapter replaces the plugin instance's internal `buildEatingListener` wait with a scoped abortable wait, resets the internal eating flag only after the owned operation settles, and awaits restoration. The package files are unchanged. These private hooks are explicit upgrade dependencies; tests exercise the installed `EatUtil`, including timeout, early cancellation, equip failure and delayed restoration. Review this adapter when upgrading. [Upstream source](https://github.com/linkle69/mineflayer-auto-eat/blob/master/src/new.ts)

## Self-defense

The initial hit must be an `entityHurt` event whose victim is the bot and whose supplied source is a currently tracked supported living mob/player within 32 blocks in the same observable world, with a loaded source chunk. Missing source information does not identify an attacker: do not attack the nearest player or infer an attacker from proximity. Older server/protocol event paths can omit sources; those hits do not trigger this feature. Unknown-source notices are rate-limited to ten seconds. Environmental damage does not launch arbitrary flight.

Response duration starts at the triggering hit. Repeated hits do not extend it. There is no additional user-configurable lockout after it ends. The known attacker remains the primary target; after death/loss, nearby supported hostile mobs within 12 blocks can be selected during the same response. Uninvolved players are never acquired by proximity. A known player attacker can be retaliated against without another role check; server PvP restrictions still apply. Creative/spectator players are not attacked.

- **Fight:** use the already-held supported sword/axe through scoped PvP. No automatic weapon selection. If no suitable weapon is held, or the target is invulnerable, fall back to flight. Held-weapon loss immediately interrupts combat.
- **Flight:** `GoalInvert(GoalFollow(threat, range))` asks for at least 12 blocks of separation and at least eight blocks beyond the separation on entry. This also makes ranged attackers trigger actual retreat when already more than 12 blocks away. One dynamic goal is installed per target/mode change. No path calculations for every observed entity.

Reconcile every 333 ms without overlapping operations or queued scan backlogs. Use non-digging movement with no pillaring/scaffolding, a 1.5-second search budget, 10 ms tick budget and bounded search setting 32. Death/gone references cannot be reused as targets. The combat lease revalidates entity identity before and after awaited PvP startup and remembers invalidated entity references, including death before despawn. A respawned player is not automatically reacquired by name. Pending look/attack work must not hit a dead or removed target. Plugin-internal unawaited stop calls have a rejection observer while explicit owners still observe failure. On a failed path, clear motion through serialized cleanup and remain inactive until the original response expires, avoiding a fresh search on every hit. With no threats, watch until the same deadline. At expiry restore normal idle behavior. Escape success, explosion evasion, projectile interception and favorable PvP outcomes are not guaranteed. Scoped PvP shield automation remains disabled, as with Protect.

## Teardown and failures

Turning a feature off, changing active response settings, Stop, task preemption, bot death, dimension/game changes and disconnect abort owned work. Remove task-owned listeners and intervals by their exact references. Dispose connection observers on replacement/retirement; old callbacks use the captured bot and cannot act on a new connection.

Drain any in-flight food equip/consume/restoration or combat startup before releasing resources. Finish the scoped combat stop, clear the owned pathfinder goal, restore saved movements/search budgets/PvP methods, clear target references and remove abort subscriptions. Response deadlines and consumption timers are canceled. Do not globally remove listeners or treat a timeout as cancellation.

A delayed meal reports cleanup trouble after ten seconds; a response reports it if still unresolved ten seconds beyond its configured duration. A task remains blocked while the operation is pending. Confirmed cleanup failure stays visible and blocks conflicting work until deployment retirement; delayed but eventually successful cleanup may release the gate. Controller disposal prevents new starts even if old cleanup completes later.

## Protect reachability notification

Protect's current stop-on-path-failure/no-progress behavior remains. A typed `PLAYER_UNREACHABLE` terminal outcome tells the session to send one private `/tell` to the protected player after teardown, while preserving the existing warning event. The text explains no usable route was found within navigation limits and asks the player to move somewhere accessible and request Protect again. It does not claim a timeout proves no route exists. The dashboard mirror labels the message private. A failed/disabled whisper is logged without breaking cleanup; no public-chat fallback is used.

## Verification and limits

Simulated tests cover idle eligibility, fixed response duration, player retaliation, weapon-loss fallback, dead-target replacement, unreachable-path suppression, task preemption, settings validation/access, pending-cleanup ownership, installed-library cancellation/listener cleanup/restoration, and the private Protect notification. Regression cases additionally cover delayed plugin injection (the original cause of auto-eat remaining unavailable), missing/full hunger, player death during an outstanding look, death during PvP startup, despawn/respawn and lifecycle event logging. No live crash stack was available; these tests establish the specific stale-target races, not every possible crash cause. Real Minecraft verification of food updates, source availability, Fight/Flight paths and plugin timing remains necessary. No many-bot performance claim is made.
