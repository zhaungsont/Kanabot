# Automatic idle behaviors

Status: implemented local runtime, 2026-11-04. Settings and execution belong to backend BotSession and continue without a browser. [Bot Upkeep](BOT_UPKEEP_DESIGN.md) separately owns **Auto-eat and Auto-armor**, including during tasks. Idle Behaviors owns only Fight/Flight, Avoid drowning, and Sleep (TODO).

## Controls and boundaries

The dashboard's **Idle Behaviors** panel has Self-defense, Fight/Flight, Response duration (1–120 whole seconds, default 10), and Avoid drowning. All toggles default off. Sleep is visibly disabled and marked **TODO**; no sleep logic is implemented.

Settings survive viewer refresh and Minecraft reconnect/respawn in the same session, not retirement/backend restart. Attached deployment authorization is required for `bot:behaviors:update`; automatic execution has no requester or gameplay RBAC check. Role changes do not affect running reactions. Concurrent viewer edits use the last accepted write, broadcast authoritatively.

`IdleBehaviors` observes self damage and oxygen, owns one operation/cancellation/status timer, and composes `SelfDefenseReaction` or `SurfaceReaction`. These modules own exact listeners, motion, settings and teardown. Shared `behaviorContracts.d.ts` is presentation data; UI components contain no game execution policy. Food code and its adapter are composed by Upkeep only.

Eligibility requires state idle, no foreground task (including a task suspended for food), no task cleanup, manual inventory action or active upkeep operation. Idle glances also yield to these owners. A new task or manual action requests cancellation and receives a retry explanation until cleanup actually settles; nothing is silently queued. Stop interrupts idle work. The existing ten-minute idle retirement still applies; automation does not renew it.

Idle status is `idle`, `surfacing`, `defending`, `stopping` or `cleanup-failed`, separate from foreground task and upkeep statuses. An already-running Fight/Flight response exposes an `EquipmentOwner`: food can pause/drain it, restore its current requirement and resume from fresh state while the original response deadline continues. No new idle reaction starts during a food transaction.

## Avoid drowning

Once per second while eligible, oxygen at most six triggers a bounded attempt to reach air. Inspect already-loaded blocks directly above, at most eight blocks; require air at both feet and head, and stop at unknown data or a solid obstruction. No digging, towers, scaffolding or parkour. Install one GoalBlock with a 1.5-second search budget, 10 ms tick budget and search radius 12. End when oxygen recovers to at least 12, path search fails, ten seconds elapse, or cancellation arrives; back off five seconds between attempts.

This is a limited idle escape, not a general drowning rescue/path planner. Caves without observed air above may require manual intervention. It never steals movement from a task, including a yielded task, and refuses food handoff until its own escape ends. Armor may run alongside it. Teardown clears its exact interval/deadline/path/abort observers and restores saved movements/search settings even after startup failure.

## Auto-eat migration

Auto-eat is no longer an idle feature. Its only scheduler is `backend/src/upkeep/upkeep.ts`, and its library adapter is `backend/src/behaviors/autoEat.ts` (the existing path is retained). Legacy behavior requests containing `autoEat` are forwarded to Upkeep at the session boundary and stripped from idle settings. See [Bot Upkeep](BOT_UPKEEP_DESIGN.md) for thresholds, post-meal guarantees, library hooks, and failure handling.

## Self-defense

The initial hit must be an `entityHurt` event whose victim is the bot and whose supplied source is a currently tracked supported living mob/player within 32 blocks in the same observable world, with a loaded source chunk. Missing source information does not identify an attacker: do not attack the nearest player or infer an attacker from proximity. Older server/protocol event paths can omit sources; those hits do not trigger this feature. Unknown-source notices are rate-limited to ten seconds. Environmental damage does not launch arbitrary flight.

Response duration starts at the triggering hit. Repeated hits do not extend it. There is no additional user-configurable lockout after it ends. The known attacker remains the primary target; after death/loss, nearby supported hostile mobs within 12 blocks can be selected during the same response. Uninvolved players are never acquired by proximity. A known player attacker can be retaliated against without another role check; server PvP restrictions still apply. Creative/spectator players are not attacked.

- **Fight:** use the already-held supported sword/axe through scoped PvP. No automatic weapon selection. If no suitable weapon is held, or the target is invulnerable, fall back to flight. Held-weapon loss immediately interrupts combat.
- **Flight:** `GoalInvert(GoalFollow(threat, range))` asks for at least 12 blocks of separation and at least eight blocks beyond the separation on entry. This also makes ranged attackers trigger actual retreat when already more than 12 blocks away. One dynamic goal is installed per target/mode change. No path calculations for every observed entity.

Reconcile every 333 ms without overlapping operations or queued scan backlogs. Use non-digging movement with no pillaring/scaffolding, a 1.5-second search budget, 10 ms tick budget and bounded search setting 32. Death/gone references cannot be reused as targets. The combat lease revalidates entity identity before and after awaited PvP startup and remembers invalidated entity references, including death before despawn. A respawned player is not automatically reacquired by name. Pending look/attack work must not hit a dead or removed target. Plugin-internal unawaited stop calls have a rejection observer while explicit owners still observe failure. On a failed path, clear motion through serialized cleanup and remain inactive until the original response expires, avoiding a fresh search on every hit. With no threats, watch until the same deadline. At expiry restore normal idle behavior. Escape success, explosion evasion, projectile interception and favorable PvP outcomes are not guaranteed. Scoped PvP shield automation remains disabled, as with Protect.

## Teardown and failures

Turning a feature off, changing active response settings, Stop, task preemption, bot death, dimension/game changes and disconnect abort owned work. Remove task-owned listeners and intervals by their exact references. Dispose connection observers on replacement/retirement; old callbacks use the captured bot and cannot act on a new connection.

Drain combat startup and any active upkeep handoff before releasing resources. Food operations belong exclusively to Upkeep. Finish the scoped combat stop, clear the owned pathfinder goal, restore saved movements/search budgets/PvP methods, clear target references and remove abort subscriptions. Response deadlines and owned observation timers are canceled. Do not globally remove listeners or treat a timeout as cancellation.

A response reports cleanup trouble if still unresolved ten seconds beyond its configured duration. Upkeep owns its separate 15-second handoff deadline. A task remains blocked while the operation is pending. Confirmed cleanup failure stays visible and blocks conflicting work until deployment retirement; delayed but eventually successful cleanup may release the gate. Controller disposal prevents new starts even if old cleanup completes later.

## Protect reachability notification

Protect's current stop-on-path-failure/no-progress behavior remains. A typed `PLAYER_UNREACHABLE` terminal outcome tells the session to send one private `/tell` to the protected player after teardown, while preserving the existing warning event. The text explains no usable route was found within navigation limits and asks the player to move somewhere accessible and request Protect again. It does not claim a timeout proves no route exists. The dashboard mirror labels the message private. A failed/disabled whisper is logged without breaking cleanup; no public-chat fallback is used.

## Verification and limits

Simulated tests cover idle eligibility, fixed response duration, player retaliation, weapon-loss fallback, dead-target replacement, unreachable-path suppression, task preemption, settings validation/access, pending-cleanup ownership, installed-library cancellation/listener cleanup/restoration, and the private Protect notification. Regression cases additionally cover delayed plugin injection (the original cause of auto-eat remaining unavailable), missing/full hunger, player death during an outstanding look, death during PvP startup, despawn/respawn and lifecycle event logging. No live crash stack was available; these tests establish the specific stale-target races, not every possible crash cause. Real Minecraft verification of food updates, source availability, Fight/Flight paths and plugin timing remains necessary. No many-bot performance claim is made.
