# Shared equipment coordination

Status: **implemented foundation**, 2026-11-05. This supersedes the original read-only-equipment-only scope of Protect. Supporting coordination was approved with [Bot Upkeep](BOT_UPKEEP_DESIGN.md); a universal equipment optimizer remains future work.

## Responsibilities and API

`backend/src/runtime/equipment.ts` contains the per-captured-bot `EquipmentService`, `EquipmentIntent`, `EquipmentOwner`, and `EquipmentUnavailable` result. It imports no gameplay task, transport, UI, or role module. BotSession composes it with tasks/upkeep/manual armor controls.

- `exclusive(work)` serializes inventory mutation until each promise actually settles. Failure does not abandon pending work or poison later queue entries.
- `EquipmentIntent.publish(requirement)` increments its revision. Requirements are unrestricted, empty, specific item, or best under a named registered policy and optional block position.
- `restore(owner, signal)` enters the lane; `reconcile(owner, fallback, signal)` is used while already holding it. Resolve current inventory, equip, read back, compare revision after awaits, and replan at most three times. A missing required item blocks readiness. Mining explicitly permits finite bare-hand selection; this is a policy result, not an arbitrary fallback.
- `registerPolicy(id, resolver)` adds a pure selection policy without editing Auto-eat. Duplicate identifiers are rejected. Future tasks implement the owner/yield contract and publish their own requirement.
- `armor(owner, signal)` runs under the same lane, considers only four armor destinations, excludes held/reserved source items and protected manual slots, awaits equip and verifies destination identity.

EquipmentOwner identity and cancellation belong to the current in-process execution. Item references and policies are not wire payloads or durable records. Task permissions and scheduling are independent.

## Current selection policies

| Policy | Delivered ranking | Limits |
| --- | --- | --- |
| `melee` | Usable sword/axe; material tier wooden/golden/stone/iron/diamond/netherite, sword preference, small Sharpness weight, stable slot order | Explicit heuristic, not universal DPS, enchantment or custom-server combat optimization |
| `mining` | Current block's `digTime(item.type, ..., item.enchants, bot.entity.effects)`, finite bare-hand time, usable durability and stable slot order | Preserves excavation's non-harvest-required scope; does not obtain missing tools or guarantee loot |
| Armor | Usable helmet/chestplate/leggings/boots; material tier leather/golden/chainmail/iron/diamond/netherite, Protection weight | No situational enchantment, Elytra/offhand or custom-armor optimization; only strictly better scored replacements |

Item comparison uses type, metadata, NBT and components, with current reference preferred. Original slot is only a tie preference. Identical copies are interchangeable. An empty-hand requirement switches to a checked empty hotbar slot and fails if none exists; it never uses a drop-capable hand unequip fallback. [Mineflayer equip implementation](https://github.com/PrismarineJS/mineflayer/blob/master/lib/plugins/simple_inventory.js), [Prismarine Item fields](https://github.com/PrismarineJS/prismarine-item/blob/master/index.d.ts)

## Integration and readiness

Attack and Protect prepare best supported melee gear at startup and after meals. Excavation publishes the current block, obtains its tool through the service, and rechecks after each await/checkpoint. Follow is unrestricted. Auto-eat temporarily acquires the hand only after the current owner confirms a safe point, then reconciles the **current** intent before resume, including on a failed/canceled meal. There is no food-specific task-name switch. See the [handoff diagram and lifecycle](BOT_UPKEEP_DESIGN.md).

The Protect read-only port in `backend/src/tasks/protect/equipment.ts` remains its immediate held-weapon readiness observer: weapon loss interrupts fighting and degrades to escort. It is not a second automatic writer. Continuous weapon upgrades/breakage replacement outside startup/food reconciliation are not implemented. Standalone Attack/Protect constructors retain optional legacy test paths; BotSession always injects the shared service.

Runtime no longer loads `mineflayer-armor-manager`'s autonomous entry point. Auto-armor's toggle is therefore authoritative for all automatic armor writes. The package remains installed. Manual armor removal/drop is serialized, matches metadata/components instead of type alone, and protects the slot until Auto-armor is disabled/re-enabled or connection replacement.

## Follow-ups and verification limits

Future work: version-aware situational weapon/armor ranking, debounced inventory/held-item dirty observation for proactive loadout maintenance, durable task/command delivery, and broader own-armor projection coverage (KI-003/KI-006). None requires coupling food policy to task implementation. New inventory writers/container tasks must join this lane and declare safe handoffs; TypeScript interfaces alone cannot police arbitrary plugin writes.

Tests cover revision changes, missing/better gear, generic policies and specific/empty requirements, compatible Follow movement, cancellation and delayed plugin operations. Live server/version checks are still needed for packet timing, inventory semantics and combat behavior. Do not advertise universal best-tool optimization or fully extracted BotSession responsibilities. [Known issues](KNOWN_ISSUES.md)
