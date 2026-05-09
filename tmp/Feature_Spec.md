# Feature Spec

## Frontend Web: Dashboard Page
- One web session can only spawn one bot at any time.
- To spawn a bot using frontend web, the user must input minecraft server IP. Optional inputs include bot name (default is mc_bot), Minecraft server version (if left blank, we'll let mineflayer library auto handle it)
- When a bot has been spawned and running, display realtime spawn duration, button to disconnect, and realtime in-game chat UI that mirrors the actual in game chat. This means the frontend needs to maintain a constant realtime connection with backend.
- When a bot starts spawning and throughout its session, display a terminal-like UI on the dashboard that logs all its events including spawn successful, killed, or disconnected...etc.
- UI color pallette: pastel style around #FFF7D1 and #FFE700. Overall give the feeling of youth & energy.
- Tech stack: React TypeScript
- Several ad placements for future Google Ads integration

## Frontend Web: Landing Page
- Display a simple link to the dashboard for now.

## Bot Creating, State, & Lifecycle (Involves Backend & Frontend Coordination)
- If a bot is idle for 10 minutes, the server auto-terminates this bot session.
  - Idling means no input from client, including no new actions from the user and the bot is not currently running an in-game task.
- Retry strategy: unless bot is kicked or banned from server, when an unexpected error causes bot to disconnect from game (or failure upon initial connection), always implement reasonable retry strategy here.
- State machine: Bot has multiple states in this build: disconnected (this also applies to when the bot has yet to join a server), spawning, dead, idle, or in a task. Task is a job issued by a player and requires the bot to spend time acting on. A bot cannot do more than one task at the same time. Current available tasks are follow and guard. Jobs that bot can perform whether the bot is doing a task or not include basic greetings, meaning the bot could be following a player (in a task) while replying to another player's greeting.
- The current task cannot be overwritten by a new task request. Meaning the "task" state can only be entered from "idle" state.

## Bot Authentication
- For now we only spawn offline mode minecraft bots (i.e.m spawning bots without giving it an actual Microsoft Minecraft account) for technical simplicity. Hence we don't need to provide an account and password for the Minecraft account.

## Bot Abilities
- Notify frontend dashboard (via backend) in the chat UI when:
  - spawned into the server
  - died
  - disconnected (and reason)
  - acknowledged a task issued by a player
- Tasks issued by a player
  - Follow a player (upon its request; forever until it receives the stop follow instruction, or until bot dies)
    - Constantly stay within 5 blocks from said player
  - Guard a player (upon its request; forever until it receives the stop guard instruction, or until bot dies)
    - Constantly stay within 5 blocks from said player while fighting off any hostile mobs within 10 blocks from said player.
  - Stop following or guarding a player
- Basic greetings (string include "hi bot" or "hello bot"): reply with "Hi there!"
- Digging / landscaping / excavating: dig a rectangular box specified by player with x, y, z axis. The bot must be able to locate the physical in-game location of the spot, equip the optimal tool based on the geology, and remove all the blocks from the specified area, before finally report that the task is finished. During the excavation, the bot should be able to switch between shovels or pickaxes depending on the block it's trying to excavate.
- locate and dig ores within a 3 dimensional area. The player will specify a 3D area denoted by 2 diagonal coordinates, and the bot will attempt to mine the specified ores within the area with the best tool. The bot is allowed to excavate other blocks within the confines, in order to navigate to the desired ores. The bot should be able to switch between shovels or pickaxes depending on the block it's trying to excavate.

## Backend
- Tech stack: NodeJS v24.15.0 (use nvm for node version control) for client request handling, mineflayer JS library for bot control implementations. TypeScript is optimal for the entire backend project to ensure type safety.
- core responsibilities include managing all bots from all clients, bot connection retry when failed, relaying realtime in-game info to client, realtime connection to frontend client as a bot session starts (to send bot's in-game info to the dashboard)

