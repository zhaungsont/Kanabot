# Feature List

## Frontend Web

1. Lets a user deploy a Minecraft bot to 1 Minecraft server after user fills in server IP (required) and the bot's name (default: "mc_bot")
2. When a bot is currently being deployed, display a button to terminate the bot session.
3. When a bot is currently being deployed, display a chat box UI that mirrors the in-game chat, which also allows user to type & send messages from the UI into the game.
4. When a bot is currently being deployed, display a number of available actions the user can take on behave of the bot, including follow a player or guard a player from hostile mobs.
# Ad banners for ad revenue

## Backend Server
1. Handles bot instantiate request from frontend and uses mineflayer library to create & connect bot to the server.
2. Handles bot connection details and lifecycle.
3. When bot is in-game, handle advanced interaction requests such as chat messages and user-invoked actions from the frontend to the game via mineflayer library.
4. manages ALL existing bots from all clients efficiently.

## Mineflayer Bot
1. Can perform tasks issued by player such as follow and guard
2. Can look at player when one is around it.