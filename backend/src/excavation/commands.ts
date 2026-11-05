import type { ExcavationRequest, ExcavationDirection } from '../../../shared/excavationContracts.js';

export const EXCAVATION_HELP = '!dig from <x> <y> <z> [east|west N] [south|north N] [up|down N]; sizes include the origin. Then !dig confirm <planId>. !dig preview / cancel / status <taskId> / stop <taskId>.';
export function parseExcavation(args: string[]): ExcavationRequest {
  const [verb, ...rest] = args;
  if (['help', 'preview', 'cancel'].includes(verb) && rest.length === 0) return { type: verb as 'help' | 'preview' | 'cancel' };
  if (['confirm', 'status', 'stop'].includes(verb) && rest.length === 1 && /^[a-zA-Z0-9-]{1,64}$/.test(rest[0])) {
    return verb === 'confirm' ? { type: 'confirm', planId: rest[0] } : { type: verb as 'status' | 'stop', taskId: rest[0] };
  }
  if (verb !== 'from' || rest.length < 5 || rest.length > 9 || rest.length % 2 !== 1 || !rest.slice(0, 3).every(s => /^-?\d+$/.test(s))) throw new Error(EXCAVATION_HELP);
  const [x, y, z] = rest.slice(0, 3).map(Number);
  const sizes: { direction: ExcavationDirection; count: number }[] = [];
  for (let i = 3; i < rest.length; i += 2) {
    if (!/^[1-9]\d*$/.test(rest[i + 1])) throw new Error('Sizes must be positive decimal integers.');
    sizes.push({ direction: rest[i] as ExcavationDirection, count: Number(rest[i + 1]) });
  }
  return { type: 'prepare', input: { origin: { x, y, z }, sizes } };
}
