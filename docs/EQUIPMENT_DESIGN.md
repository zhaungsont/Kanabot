# Equipment module follow-up

Status: documented future work; **do not implement automatic equipping as part of the initial Protect overhaul**. Updated 2026-11-04. The initial placeholder is implemented in `backend/src/tasks/protect/equipment.ts`. Protect receives only the interface and read-only placeholder below. See [PROTECT_DESIGN.md](PROTECT_DESIGN.md).

## 1. Current gaps

Protect now reads only the held weapon, replacing Guard's startup/collection selector. Attack retains a separate selector; excavation uses the tool plugin; armor is managed through another plugin and manual drop controls. These paths have no common inventory-operation coordinator. The old Guard selector did not reliably react to breakage/replacement and selection ignores enchantments, combat timing, and durability.

Existing armor update/drop defects are tracked as KI-006/KI-007; asynchronous tool cancellation as KI-002 in [KNOWN_ISSUES.md](KNOWN_ISSUES.md). This document records their relationship to equipment work without authorizing those fixes now.

## 2. Stable interface and initial placeholder

Conceptual contract; choose final names during implementation:

```text
EquipmentPort
  prepare(context, cancellationSignal) -> readiness result
  subscribeReadiness(listener) -> unsubscribe
  release(taskGeneration) -> completion

EquipmentContext
  taskGeneration, purpose (melee protection initially)
  optional target traits for future selection

Readiness
  ready | unavailable | failed
  reasonCode, equipmentRevision
```

The interface describes needed readiness, not a particular inventory slot or ranking algorithm. The caller can wait/cancel without knowing how selection works. Readiness is a snapshot, not a guarantee that a weapon cannot break on the next hit.

The initial placeholder reads the held item and reports ready for a supported sword/axe; otherwise unavailable with `AUTOMATIC_EQUIPPING_DEFERRED`. It may listen for held-item changes to publish readiness. It performs **no inventory writes**, no ranking, no periodic best-weapon scans, no purchases/crafting, and no implicit calls to old selectors. Preparation/release resolve promptly and cancellation is harmless. Replacing it with the real module should not require rewriting Protect's state machine.

Read-only readiness handling is part of the placeholder, not an implementation of automatic selection. Protect handles unavailable readiness by escorting without melee and reporting degraded protection. Players/operators must arrange the held weapon using existing/manual means. Other legacy equipment paths remain unchanged until separately migrated.

### Release and teardown contract

Each consumer owns its readiness unsubscribe handle and task generation. Unsubscribe prevents further delivery immediately; `release(taskGeneration)` is idempotent and must invalidate pending preparation callbacks before resolving. The placeholder removes its own `heldItemChanged` handler if acquired, clears consumer references, and performs no inventory writes or inventory restoration. Partial preparation and repeated release use the same disposer path.

The future real module must additionally cancel its reconciliation/debounce/retry timers, remove its own inventory listeners, drain/cancel its serialized operation, discard stale selected-item/slot references, and release resource ownership only after no late mutation can affect a successor. An operation deadline alone is not proof that a server-side equip was canceled. Preserve unrelated consumers and plugin/core listeners; never use global listener removal. Shared observation stops only after its final consumer releases it. Full Protect teardown ordering and plugin failure handling are specified in [PROTECT_DESIGN.md](PROTECT_DESIGN.md#32-full-teardown-sequence).

### Auto-eat integration

Idle Auto-eat is separately authorized and implemented through the library adapter described in [IDLE_BEHAVIORS.md](IDLE_BEHAVIORS.md). It temporarily equips food and awaits restoration, with a cleanup gate before tasks or self-defense acquire execution. This does not add weapon ranking or implement the deferred equipment coordinator. Protect's equipment port remains read-only; legacy passive armor/Attack/mining paths still need explicit migration.

## 3. Planned real equipment implementation

### Observation

Listen to inventory `updateSlot` and `heldItemChanged`, with collection only as an additional hint. Debounce/coalesce bursts and mark the loadout dirty. Add a slow reconciliation check, initially about three seconds, while a consumer needs equipment. Re-evaluate immediately after a held weapon disappears. Own and remove subscriptions/timers with the consumer lifecycle. [Mineflayer API](https://github.com/PrismarineJS/mineflayer/blob/master/docs/api.md)

### Selection policy

Separate a pure selector from the inventory executor. Compare supported weapons using tested version-aware damage/attack timing, applicable enchantments, remaining durability, and a stable tie-breaker. Avoid replacing a nearly equivalent usable weapon repeatedly. Preserve a reasonable fallback when no preferred weapon exists; bare-handed combat requires an explicit caller policy rather than an accidental fallback.

Use `durabilityUsed` and `enchants` through supported item APIs, with version-correct maximum durability/attributes when available. Do not read fixed NBT paths that differ across item component versions. Unknown custom-server effects remain unknown; do not advertise an exact universal DPS optimizer. [Prismarine Item API](https://github.com/PrismarineJS/prismarine-item#api)

### Serialized inventory operations

- One in-flight equipment mutation per bot; no overlapping equip/unequip/drop/tool operations on the same resources.
- Revalidate slot, item identity, and equipment/task generation immediately before each mutation. Use item metadata/identity, not type-only matching.
- Check cancellation after every await. A canceled equip completion must never restart motion/combat or act on a new bot instance.
- Compare the currently held item's identity before equipping; a slot-update event caused by our equip must not create a feedback loop.
- Bound retries/timeouts. Confirm resulting inventory state before reporting success, and return structured failure/degraded readiness when uncertain.
- Treat a selected weapon becoming invalid or breaking as new state, not a reason to retry the same stale item indefinitely.

### Shared resource ownership

Coordinate weapon selection, mining tool selection, armor automation, and explicit dashboard inventory changes through a small per-bot coordinator. Define which operations wait, reject, or supersede pending preparation. Plugin-owned automatic writes cannot be assumed to honor an application lock; inspect/configure/migrate those paths explicitly before claiming exclusive ownership.

Do not build a general distributed inventory service. Resource control stays beside the Mineflayer runtime. Persist configuration later if required, not live Item objects or in-flight promises. RBAC determines whether a user may request the parent action; equipment selection does not interpret player roles.

## 4. Rollout after separate approval

1. Implement/test the selector and serialized executor behind EquipmentPort, initially for Protect melee weapons.
2. Test breakage, slot movement, same-type items with different metadata, rapid inventory events, cancellation/disconnect, and concurrent requests.
3. Integrate standalone Attack, excavation tools, armor observations/automation, and manual drops in explicit slices. Preserve existing public behaviors or document approved changes.
4. Fix related inventory defects with dedicated regression cases. Keep the read-only placeholder available for testing unsupported/degraded configurations.

Release criteria include no duplicate/redundant equips, no post-cancellation side effects, bounded failure recovery, and readiness events matching actual inventory. Real-server/version checks supplement mocked state. Until this work is separately approved and completed, Protect's first release must continue to describe automatic equipment handling as deferred.
