# Kanabot Roadmap

Status: first draft for discussion. Updated: 2026-10-20.

This document defines proposed product scope and release criteria. It does not claim that these features are implemented. The architecture and delivery approach are described in [ARCHITECTURE.md](ARCHITECTURE.md).

## Product direction

Kanabot is a Bot-as-a-Service platform for deploying Minecraft helper bots into users' existing servers. Users manage bots through a friendly web dashboard, while Mineflayer provides most low-level Minecraft interaction. Kanabot supplies useful tasks, games, observation, AI interaction, and the systems needed to operate bots reliably.

The service does not provision or host Minecraft game servers. Its initial compatibility target is an explicitly tested subset of Minecraft Java Edition servers. Server versions, authentication modes, plugins, and mods must be advertised according to tested compatibility; support for every Minecraft world is not assumed.

## Milestone order and interpretation

The planned release order is:

1. **Local MVP** — prove the complete core experience on a locally operated installation.
2. **Local Stable (1.0)** — make the local product reliable and expand the selected feature families.
3. **Cloud MVP** — offer the basic experience as a limited hosted service.
4. **Cloud Stable (1.0)** — operate the fuller experience reliably for multiple users.

Local means the Kanabot application, database, and bot workers run on an operator's machine. The Minecraft server may be local or remote. AI and other integrations may still require external services and incur charges. Local MVP is a development/pilot release; Local Stable targets a self-hosted operator and a small trusted group, not an internet-facing public service.

The cloud milestones reuse the local feature sets and implementation. Cloud MVP initially exposes the Local MVP feature tier; fuller features already developed for Local Stable remain in the shared codebase behind rollout controls. Cloud Stable brings those features into supported hosted operation. This is a change in deployment and availability, not a second implementation or a rollback of local capabilities.

"Basic" means a useful end-to-end subset. "Full" means the bounded 1.0 scope defined below, not every conceivable future capability. Later milestones inherit earlier capabilities even when a feature family is not listed as a new addition. There are no delivery dates or concurrency promises in this draft.

| Feature family | Local MVP | Local Stable (1.0) | Cloud MVP | Cloud Stable (1.0) |
|---|---|---|---|---|
| User platform | Basic accounts, bot ownership, saved configuration, dashboard | Full 1.0 management, history, presets, scheduling, controlled sharing | Basic tier with hosted identity and tenant isolation | Full tier with hosted administration and recovery |
| Minecraft assistance | Follow, protect, stop, bounded excavation, equipment | Harden and extend the same task system | Basic tier verified on supported remote servers | Stable assistance under measured service limits |
| Games and coordination | One bounded player-versus-bot sparring mode | Reliable games and limited multi-bot coordination | Basic mode with strict capacity and participation controls | Supported coordination within published limits |
| AI interaction | Basic text conversation with bounded context | Full 1.0 task interaction, configurable memory, bounded plans | Basic tier with strict spending limits | Full tier with provider failure handling and usage controls |
| World observation | Basic status, inventory/equipment, position, nearby-world summary | Full 1.0 viewer, on-demand captures, selected AI vision use cases | Basic tier with private subscriptions and bounded traffic | Full tier with separate rendering capacity and retention controls |
| External integrations | Internal extension boundaries only | Versioned adapters and one supported outbound event integration | Disabled or restricted during the basic rollout | Enable the supported integration set after cloud validation |
| Monetization | No commercial feature requirement | Website placements and optional in-game sponsorship pipeline, testable locally | Disabled by default while core service is validated | Production-ready delivery and reporting if the business chooses activation |

## 1. Local MVP

### Outcome

A user can sign in, save a bot, connect it to a supported server, issue useful tasks, try a simple game, converse with it, and inspect its state. Browser refreshes do not terminate the bot. Work remains deliberately limited in scope and resource consumption.

### Basic user platform

- A local account/sign-in flow backed by the same authentication system intended for cloud use. One operator account is sufficient initially, but bots and data have explicit owners and ownership checks.
- An Aternos-inspired dashboard for saved server profiles and bots, including start/stop, status, chat, current task, uptime, and clear errors.
- Persist bot configuration, task outcomes, and a bounded recent event history. Give bots stable IDs independent of browser connections.
- Reconnect a dashboard to an existing run. Enforce a configurable active-bot cap; one active bot per owner is an acceptable initial default.
- Support a documented offline-mode server configuration first. Account recovery, collaboration, and general online-mode onboarding belong to Local Stable.

### Minecraft assistance

- Follow a named player, protect a named player from supported hostile entities, and stop promptly.
- Excavate a bounded rectangular region with validated integer coordinates, tool selection, progress, cancellation, and explicit reporting of incomplete or unreachable work.
- Equip suitable available weapons/armor and expose equipment state and controlled unequip/drop actions.
- Define movement and inventory conflict rules so tasks cannot accidentally compete for the same bot controls.
- Prioritize reliable existing abilities. Crafting chains, farming, building from schematics, and selective ore mining are not MVP requirements.

### Games and coordination

- One manually started, bounded player-versus-bot sparring mode on an operator-approved server, with an explicit participant, stop condition, and end result.
- Coordinate the human's instructions with the bot's current task. Autonomous teams, matchmaking, rankings, tournaments, and multi-bot strategies are deferred.
- Reuse the task, equipment, and movement interfaces used by assistance features. Bots join the user's existing world; Kanabot does not provision arenas or game servers.

### Basic AI interaction

- Text conversation through one supported model-provider adapter, with short session context and optional read-only bot/world facts.
- Explicit enable/disable, request timeout, message/rate limits, spending allowance, and visible failure states. Core Minecraft abilities continue when AI is unavailable.
- Keep greetings and deterministic task controls usable without AI. Autonomous planning, persistent semantic memory, and model-driven gameplay are deferred.

### Basic world observation

- Display health, food, position, connection/task state, inventory/equipment, and a bounded summary of nearby loaded entities/blocks where supported.
- Use a versioned observation format that can later support a viewer and AI inputs.
- First-person rendering, screenshots for AI, recording, and continuous video are deferred. A textual or simple schematic view is sufficient for MVP.

### Completion criteria

- Demonstrate each included feature on a documented server/version test fixture, with a manual check of real AI interaction when configured.
- Refresh or close the browser and reconnect to the same bot; verify that another account cannot access it.
- Verify task cancellation, death/respawn, disconnect/retry, and manual stop. A pending retry must not resurrect a stopped bot.
- Persist definitions across application restart; report interrupted runs accurately. Do not claim seamless task continuation after restart.
- Validate destructive actions and report excavation failures accurately rather than treating skipped blocks as successful completion.
- Record an initial CPU, memory, bandwidth, and event-loop baseline for idle, follow, excavation, and sparring workloads.

## 2. Local Stable (1.0)

### Outcome

A self-hosted operator can run the selected feature set predictably, recover from ordinary failures, and maintain the installation. All Local MVP abilities remain supported and are hardened before more complex behavior is added.

### Full user platform

- Multiple owned bot definitions and server profiles; concurrent runs limited by configured and measured capacity.
- Configuration presets, export/import without secrets, task/run history with retention controls, and a scheduler with expiry and concurrency policies.
- Owner/operator roles and a narrow sharing model, such as view versus control permissions. Enterprise organizations and complex role hierarchies are deferred.
- Supported sign-in recovery and session management appropriate to the chosen login method, plus data export/deletion and audit history for important actions.
- A supported Microsoft/Minecraft account-linking path for online-mode servers, with protected per-account tokens, reauthorization, and clear account/compatibility errors. Kanabot login and Minecraft authorization remain separate.
- Documented install, upgrade, migration, backup, and restore procedures.

### Assistance and games maturation

- Harden follow, protection, equipment handling, excavation, and sparring with regression scenarios and resource limits.
- Support a small, explicitly bounded group of owned bots for coordinated start/stop/follow operations. Define participant ownership and task conflicts.
- Resume only task types with implemented checkpoints and world-state verification; otherwise expose an interrupted outcome and a deliberate restart action.
- Selective ore mining is a candidate extension after excavation is reliable. It is not a prerequisite for 1.0. Advanced building/farming automation and competitive ranking remain future scope.

### Full AI interaction

- Natural-language requests can invoke approved capabilities through validated typed tools. Destructive actions have an owner-configurable confirmation policy.
- Bounded multi-step plans with visible steps, cancellation, timeout, and failure reporting. Plans coordinate existing abilities rather than bypassing their controls.
- Configurable per-bot context/personality and opt-in persistent memory with retention/deletion controls.
- Provider selection through the shared adapter contract, with at least one supported provider, model configuration, cost metering, and spending ceilings.
- Handle provider failures and untrusted in-game text without granting extra authority or exposing secrets. Open-ended unattended autonomy is outside the 1.0 commitment.

### Full world observation

- A supported interactive world/bot viewer and on-demand captures, with owner-controlled access.
- At least one bounded visual-analysis use case using a supported capture source and vision-capable model; distinguish the rendered view from structured observations.
- Configurable capture frequency, resolution, storage retention, and rendering budget. Stop observation work independently of the Minecraft connection.
- Continuous video recording, unlimited streaming, and exhaustive world reconstruction remain future scope.

### External integrations

- Versioned integration contracts, capability checks, configuration validation, and documented authentication/error behavior.
- One supported outbound event adapter, such as task-completion webhooks, with bounded retries, destination restrictions, and delivery history.
- Document how a server plugin/mod can expose optional capabilities. Integrate additional mods only after compatibility and permission checks; the existence of a mod does not imply automatic support.
- Integrations are trusted, shipped adapters. Public user-uploaded code and a plugin marketplace are deferred.

### Monetization

- Configurable website banner placements with test creatives and an adapter boundary for a future ad provider.
- An optional in-game sponsorship delivery path, initially a controlled chat-message format, with server-owner opt-in, frequency limits, task-priority rules, and a kill switch.
- Campaign/placement configuration, delivery counters, and usage/entitlement records. Keep credentials and private game content out of reporting.
- Prove delivery locally using test campaigns. Actual paid campaigns, ad-network enrollment, payouts, and payment processing depend on a later business decision; revenue is not a release criterion.

### Completion criteria

- Complete end-to-end, ownership, cancellation, recovery, and compatibility checks for every advertised capability.
- Exercise worker failure, application restart, provider failure, interrupted tasks, upgrades, and a restore from backup.
- Establish repeatable workload measurements and an explicit local capacity recommendation. No supported load may starve the dashboard or emergency stop path.
- Test AI spending limits, observation limits, credential isolation, webhook restrictions, and advertising opt-in/disable behavior.
- Publish known limitations and supported server/authentication modes. Optional external features can be disabled, but their supported implementation must be tested before claiming completion.

## 3. Cloud MVP

### Outcome

An invite-only group can use the basic product through a hosted dashboard, while bot execution runs on a controlled cloud host. Feature breadth is comparable to Local MVP; service safety, identity, networking, and operational controls are additional requirements.

### Feature availability

- Hosted sign-in, owned bot/server configuration, start/stop, chat, recent history, and reconnectable live state.
- Follow, protection, bounded excavation, equipment controls, the basic sparring mode, basic AI conversation, and basic observation.
- Publish the server versions and authentication paths verified in the cloud. Existing online-mode support from Local Stable may be enabled after cloud credential and connectivity checks; an offline-only pilot must be labeled accordingly.
- Use the same capabilities and saved configuration schemas as the local build. Fuller AI, rendering, integrations, and monetization remain disabled or restricted until separately verified for hosted use.

### Cloud-specific requirements

- Production HTTPS, secure sessions, authenticated live subscriptions, and per-user authorization on every command and data access.
- Internet-facing validation, rate limits, server-destination/egress restrictions, credential isolation, and operator stop/suspend controls.
- A bounded deployment queue, global and per-user capacity limits, runtime allowances, and AI spending caps. Admission rules work even with no dashboard open.
- Reachability checks and clear documentation for remote servers. LAN/private worlds require an explicit connector or tunnel arrangement; user-supplied private addresses are not accepted as cloud destinations.
- Monitoring, bounded logs, retained usage records, off-host backups, restore instructions, and an operator recovery procedure.
- A single host and region are acceptable. Publishing a measured pilot limit is required; high availability, automatic scaling, and multiple regions are not MVP requirements.

### Completion criteria

- Two independent users can operate concurrently without seeing or controlling each other's bots, observations, history, credentials, or AI context.
- Test browser loss, bot-process failure, backend restart, host restart, backup restore, quota exhaustion, and a destination that cannot be reached.
- Run the supported feature paths against external test servers and record cloud RTT, resource usage, and operating cost at the pilot limit.
- Confirm that retries, scheduled work, and AI requests cannot bypass disabled features, capacity limits, or spending limits.
- Provide a clear account of availability and support limitations. A successful local run alone does not qualify a feature as cloud-ready.

## 4. Cloud Stable (1.0)

### Outcome

The selected Local Stable feature set is supported as a hosted service, with measured capacity, controlled spending, maintainable releases, and documented failure recovery.

### Feature availability

- Full user management, presets, history, scheduling, controlled sharing, and supported Minecraft account linking.
- Stable assistance, bounded games/coordination, full AI interaction, full observation, and the validated integration set.
- Monetization delivery/reporting can be activated if the business elects to use it. If inactive, its tested implementation remains available behind controls; billing and subscriptions are separate future product decisions.

### Service maturity

- Allocate execution capacity by workload and enforce fair quotas across users; separate expensive AI/rendering work from latency-sensitive bot operation.
- Support adding worker hosts using the existing runner contract. Introduce multiple regions only when latency measurements justify them.
- Define deployment draining, schema/contract compatibility, rollback, worker replacement, and interruption semantics. A bot restart can require a new Minecraft connection.
- Operate alerts, auditable administrative actions, tested off-host restores, dependency/security updates, and bounded retention for history, screenshots, and AI memory.
- Publish supported concurrency, availability goals, recovery objectives, server compatibility, and usage limits based on measurements. Numerical targets must be chosen before sign-off, not invented in this draft.
- Validate the supported operating envelope through repeatable load and failure scenarios. Document residual single-host risks if the deployment is not highly available.

### Completion criteria

- Every enabled feature meets the Local Stable criteria and its hosted isolation, resource, and compatibility checks.
- Meet the selected performance and recovery targets during a documented soak/load run and recovery exercises.
- Demonstrate adding/replacing a worker without duplicate authorized ownership or stale-run state updates. Do not promise zero interruption of Minecraft connections.
- Verify deployment rollback, database restore, quota enforcement, provider outages, and integration/monetization disable controls.
- Produce an operating-cost report at the supported load and a capacity/incident runbook. A public stable label requires an explicit decision about the remaining operational risks.

## Sequencing recommendations

The four releases remain chronological. However, completing a broad local 1.0 before any cloud testing creates avoidable risk: authentication callbacks, remote connectivity, process limits, latency, rendering dependencies, and recovery can behave differently on a hosted machine.

1. Establish the shared identity, persistence, runner, task, and configuration boundaries during Local MVP. These are foundations, not work deferred to Cloud MVP.
2. Start disposable cloud deployment and restore smoke tests once the Local MVP foundation works. Continue them during Local Stable development. These are engineering checks, not an early public release or an extra milestone.
3. Deliver each capability as a small end-to-end slice and run it against the same contracts in both environments. Cloud rollout switches change availability and limits, not behavior implementations.
4. Keep Local Stable's "Full" scopes bounded. Validate core assistance and the simple game before expanding AI, vision, or monetization. Real advertising revenue need not block a technical release.
5. If early hosted-user feedback becomes the overriding objective, consider explicitly changing the order to Local MVP -> Cloud MVP -> Local Stable -> Cloud Stable. That is an alternative requiring a product decision; it is not the plan adopted by this draft.

## Budget and scope controls

The initial upkeep target is at most US$5/month, ideally lower. Treat it as a target for a restricted pilot using suitable low-cost or free resources, not a guarantee for arbitrary concurrency, AI inference, rendering, storage, or high availability. Recheck provider pricing and terms when selecting infrastructure.

Track host/storage/backup cost, traffic, bot-hours, AI spend, and observation usage separately. Use bounded queues, explicit runtime allowances, spending caps, and workload limits. Stop admitting work before exceeding the configured budget. Advertising revenue must not be assumed to cover costs.

Do not force a paid broker, managed database, or orchestration cluster into the first deployment. The same software should remain usable on one host and support additional capacity when measured demand and funding justify it.

## Current starting point

The repository already contains a React/Vite dashboard, Express/Socket.IO backend, in-memory bot management, follow/guard/chat/equipment behavior, and experimental excavation. Existing armor-panel changes are work in progress. This is useful prototype functionality, but it does not meet the expanded Local MVP above.

Accounts, durable bot ownership, independent workers, AI, observation beyond the existing dashboard, games, and cloud operation are proposed work. Consult [README.md](README.md), [spec.md](spec.md), and [tmp/Feature_Spec.md](tmp/Feature_Spec.md) for earlier intent/current descriptions; those documents contain known drift and are not evidence of release completion.
