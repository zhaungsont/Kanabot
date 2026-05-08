# Changelog

All notable changes to Kanabot will be documented in this file.

Format: `[version] — YYYY-MM-DD`

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
