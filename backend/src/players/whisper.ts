import type { Bot } from 'mineflayer';
import type { PlayerCommandResult } from '../../../shared/playerContracts.js';
import { findPlayer, PLAYER_NAME_PATTERN } from './playerTarget.js';

export const MAX_WHISPER_LENGTH = 200;

export function whisperToPlayer(bot: Bot, target: string, message: string): PlayerCommandResult {
  if (typeof target !== 'string' || !PLAYER_NAME_PATTERN.test(target)) return { ok: false, error: 'Invalid Minecraft player name.' };
  if (typeof message !== 'string' || !message.trim() || message.length > MAX_WHISPER_LENGTH
    || /[\u0000-\u001f\u007f]/u.test(message)) {
    return { ok: false, error: `Whispers must contain 1–${MAX_WHISPER_LENGTH} characters on one line.` };
  }
  const player = findPlayer(bot, target);
  if (!player) return { ok: false, error: `Player "${target}" is no longer on the server.` };
  if (player.username === bot.username) return { ok: false, error: 'Choose another player to whisper to.' };
  bot.whisper(player.username, message.trim());
  // This acknowledges sending /tell, not server-side delivery (servers may disable it).
  return { ok: true };
}
