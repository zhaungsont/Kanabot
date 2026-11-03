# Kanabot repository instructions

Applies repository-wide. Keep this file at the Git repository root; detailed project documentation lives in `docs/`.

## Working boundaries

- Modify this instruction file only when the user explicitly authorizes it; the current authorization is for this edit only.
- Preserve unrelated working-tree changes. Do not stage, commit, or push unless requested.
- Never commit or log `.env` contents, Minecraft/provider credentials, or bot access tokens.
- Ask before adding production dependencies or performing destructive database/production operations.
- Use simulated Mineflayer fixtures for routine verification; live Minecraft actions require task authorization.

## Project and architecture

Kanabot is a Minecraft bot-as-a-service project: React/TypeScript/Vite dashboard, Node/TypeScript/Express/Socket.IO backend, and Mineflayer with plugins for low-level game behavior.

- The backend owns bot execution. Browser unmount, refresh, or socket loss must only detach a viewer, never stop a bot.
- Preserve stable bot IDs, authorized reattachment, explicit retirement, retry cancellation, and idempotent create behavior. A public bot ID alone grants no control.
- Keep transport adapters separate from the session registry and runtime features. Do not introduce React or Socket.IO dependencies into task execution modules.
- Keep UI components focused on presentation and callbacks; put game rules and execution in backend modules. The dashboard is expected to undergo a substantial redesign.
- Put shared wire types in `shared/`; use JSON-compatible payloads and ISO timestamp strings. TypeScript declarations are not runtime input validation.
- Tasks must own their asynchronous work, cancellation, listeners, timers, and cleanup. Coordinate shared movement/combat/equipment resources before starting conflicting work.
- Preserve opt-in player telemetry: sample cached state at most every three seconds, suppress unchanged snapshots, and stop sampling when the final interested viewer leaves.
- Current sessions/history are in memory and share the API process. PostgreSQL, account authentication, and separate workers in the architecture document are proposed, not installed infrastructure.
- Keep changes focused; reuse existing modules and dependencies before introducing abstractions or infrastructure.

## Repository map

- `backend/src/index.ts`: server composition and HTTP health endpoint.
- `backend/src/sessions/`: session transport adapter; `botManager.ts`: runtime registry, access checks, viewers, bounded snapshots.
- `backend/src/botSession.ts`: Mineflayer lifecycle and current feature orchestration.
- `backend/src/players/`: roster projection, target validation, whisper logic, player socket adapter.
- `backend/src/tasks/`: follow, attack, and excavation execution; guard remains in BotSession pending extraction.
- `backend/test/`: Node test-runner/tsx tests and simulated Mineflayer fixtures.
- `frontend/src/components/`, `pages/`: presentation; `hooks/`: React state/transport adapters; `services/`: framework-independent client helpers.
- `shared/`: bot, player, lifecycle, and socket contracts; `backend/src/types.ts` and `frontend/src/types.ts` re-export these.
- `legacy/`: old prototype, not the active application; do not copy its architecture into new code. `tmp/` contains historical product notes.

## Documentation: load only what the task needs

- Setup and current component/data-flow diagrams: [docs/README.md](docs/README.md).
- Architecture/lifecycle changes: [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md); distinguish implemented foundations from proposed cloud design.
- Feature and wire-protocol changes: [docs/spec.md](docs/spec.md).
- Milestone planning: [docs/ROADMAP.md](docs/ROADMAP.md).
- Bug review/follow-ups: [docs/KNOWN_ISSUES.md](docs/KNOWN_ISSUES.md). Do not silently fix deferred issues outside the task's scope.
- Update affected docs and [docs/CHANGELOG.md](docs/CHANGELOG.md) when behavior or contracts change. Keep Markdown links relative to their containing document.

## Commands and verification

Use Node from `backend/.nvmrc` (currently 24.15.0) and npm. There is no root package/workspace script, pnpm setup, or configured lint command.

| Purpose | Command from repository root |
| --- | --- |
| Install missing dependencies | `npm --prefix backend install` and `npm --prefix frontend install` |
| Run both local dev servers | `bash run_all.sh` |
| Backend regression tests | `npm --prefix backend test` |
| Backend production/type check | `npm --prefix backend run build` |
| Frontend type check + production build | `npm --prefix frontend run build` |

- For backend changes, run relevant regression tests and the backend build; frontend changes require the frontend build. Shared-contract changes require both builds.
- Add meaningful regression coverage for lifecycle, authorization, cancellation, and subscription changes. Tests use mocks and do not prove live Minecraft compatibility.
- Check reconnect behavior without duplicate bot creation and verify explicit stop cannot be undone by a pending retry when changing lifecycle code.
- Documentation-only changes need path/link and diff checks, not a full application test run. Do not edit generated `dist/` or dependency files directly.
- Report checks actually run, failures or unavailable checks, and material remaining limitations. Do not claim browser/gameplay verification from mock tests.
