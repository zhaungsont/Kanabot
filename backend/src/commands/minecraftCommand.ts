import type { BotAction } from '../types.js';

export type ParsedMinecraftCommand = { kind: 'ignore' } | { kind: 'invalid'; error: string } | { kind: 'action'; action: BotAction };
/** Parse intents only; sender authority is decided by BotCommandService. */
export function parseMinecraftCommand(username: string, message: string): ParsedMinecraftCommand {
  const [verb, ...args] = message.trim().split(/\s+/);
  const command = verb?.toLowerCase();
  if (command === '!stop') return args.length ? { kind: 'invalid', error: 'Usage: !stop' } : { kind: 'action', action: { type: 'stop' } };
  if (command === '!follow' || command === '!guard' || command === '!attack') {
    if (args.length > 1) return { kind: 'invalid', error: `Usage: ${command} [player]` };
    return { kind: 'action', action: { type: command.slice(1) as 'follow' | 'guard' | 'attack', target: args[0] ?? username } };
  }
  if (command === '!dig' || command === '!excavate') {
    if (args.length !== 6) return { kind: 'invalid', error: 'Usage: !dig <x1> <y1> <z1> <x2> <y2> <z2>' };
    const [x1, y1, z1, x2, y2, z2] = args.map(Number);
    return { kind: 'action', action: { type: 'excavate', region: { x1, y1, z1, x2, y2, z2 } } };
  }
  return { kind: 'ignore' };
}
