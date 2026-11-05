import type { BotAction } from '../types.js';
import type { ExcavationRequest } from '../../../shared/excavationContracts.js';
import { parseExcavation } from '../excavation/commands.js';

export type ParsedMinecraftCommand = { kind: 'ignore' } | { kind: 'invalid'; error: string } | { kind: 'action'; action: BotAction } | { kind: 'excavation'; request: ExcavationRequest };
/** Parse intents only; sender authority is decided by BotCommandService. */
export function parseMinecraftCommand(username: string, message: string): ParsedMinecraftCommand {
  const [verb, ...args] = message.trim().split(/\s+/);
  const command = verb?.toLowerCase();
  if (command === '!stop') return args.length ? { kind: 'invalid', error: 'Usage: !stop' } : { kind: 'action', action: { type: 'stop' } };
  if (command === '!follow' || command === '!protect' || command === '!guard' || command === '!attack') {
    if (args.length > 1) return { kind: 'invalid', error: `Usage: ${command} [player]` };
    return { kind: 'action', action: { type: command === '!guard' ? 'protect' : command.slice(1) as 'follow' | 'protect' | 'attack', target: args[0] ?? username } };
  }
  if (command === '!dig' || command === '!excavate') {
    try { return { kind: 'excavation', request: parseExcavation(args) }; }
    catch (error) { return { kind: 'invalid', error: (error as Error).message }; }
  }
  return { kind: 'ignore' };
}
