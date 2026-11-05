import { Vec3 } from 'vec3';
import type { ExcavationInput } from '../../../shared/excavationContracts.js';
import type { ExcavateRegion } from '../types.js';
import type { Bot } from 'mineflayer';

export const MAX_EXCAVATE_BLOCKS = 10_000;
export const MAX_EXCAVATE_AXIS = 128;
export const MAX_APPROACH_DISTANCE = 32;
export const isAir = (name: string) => ['air', 'cave_air', 'void_air'].includes(name);
/** Present at runtime in Mineflayer's game plugin, absent from its declarations. */
export function dimensionHeight(bot: Bot): [number, number] { return [Reflect.get(bot.game, 'minY'), Reflect.get(bot.game, 'height')]; }
const directions = { east: ['x', 1], west: ['x', -1], up: ['y', 1], down: ['y', -1], south: ['z', 1], north: ['z', -1] } as const;

/** Runtime validation precedes arithmetic/allocation; counts include the origin. */
export function fromSizes(value: unknown): ExcavateRegion {
  if (!value || typeof value !== 'object') throw new Error('Invalid excavation input.');
  const input = value as ExcavationInput;
  if (!input.origin || !['x', 'y', 'z'].every(k => Number.isSafeInteger(Reflect.get(input.origin, k)))) throw new Error('Origin must contain integer X, Y and Z.');
  if (!Array.isArray(input.sizes) || input.sizes.length < 1 || input.sizes.length > 3) throw new Error('Specify one to three direction/size pairs.');
  const end = { ...input.origin }, used = new Set<string>();
  for (const pair of input.sizes) {
    if (!pair || !Object.hasOwn(directions, pair.direction)) throw new Error('Invalid excavation direction.');
    const [axis, sign] = directions[pair.direction];
    if (used.has(axis)) throw new Error('Specify each axis only once.');
    if (!Number.isSafeInteger(pair.count) || pair.count < 1 || pair.count > MAX_EXCAVATE_AXIS) throw new Error(`Sizes must be integers from 1 to ${MAX_EXCAVATE_AXIS}.`);
    used.add(axis); end[axis] += sign * (pair.count - 1);
  }
  return normalizeRegion({ x1: input.origin.x, y1: input.origin.y, z1: input.origin.z, x2: end.x, y2: end.y, z2: end.z });
}
export function normalizeRegion(value: unknown): ExcavateRegion {
  if (!value || typeof value !== 'object') throw new Error('Invalid excavation bounds.');
  const r = value as ExcavateRegion;
  if (!['x1', 'y1', 'z1', 'x2', 'y2', 'z2'].every(k => Number.isSafeInteger(Reflect.get(r, k)) && Math.abs(Reflect.get(r, k)) <= 30_000_000)) throw new Error('Invalid excavation coordinates.');
  const result = { x1: Math.min(r.x1, r.x2), y1: Math.min(r.y1, r.y2), z1: Math.min(r.z1, r.z2), x2: Math.max(r.x1, r.x2), y2: Math.max(r.y1, r.y2), z2: Math.max(r.z1, r.z2) };
  if ([result.x2 - result.x1, result.y2 - result.y1, result.z2 - result.z1].some(n => n >= MAX_EXCAVATE_AXIS) || volume(result) > MAX_EXCAVATE_BLOCKS) throw new Error(`Excavation exceeds policy: ${MAX_EXCAVATE_BLOCKS} positions, ${MAX_EXCAVATE_AXIS} per axis.`);
  return result;
}
export function volume(r: ExcavateRegion): number { return (r.x2 - r.x1 + 1) * (r.y2 - r.y1 + 1) * (r.z2 - r.z1 + 1); }
export function contains(r: ExcavateRegion, p: { x: number; y: number; z: number }): boolean {
  return p.x >= r.x1 && p.x <= r.x2 && p.y >= r.y1 && p.y <= r.y2 && p.z >= r.z1 && p.z <= r.z2;
}
export function positions(r: ExcavateRegion): Vec3[] {
  const result: Vec3[] = [];
  for (let y = r.y2; y >= r.y1; y--) for (let x = r.x1; x <= r.x2; x++) for (let i = 0; i <= r.z2 - r.z1; i++) result.push(new Vec3(x, y, (x - r.x1) % 2 ? r.z2 - i : r.z1 + i));
  return result;
}
export function validateHeight(r: ExcavateRegion, minY: number, height: number): void {
  if (!Number.isInteger(minY) || !Number.isInteger(height) || height <= 0) throw new Error('Dimension height is not available yet.');
  if (r.y1 < minY || r.y2 >= minY + height) throw new Error(`Y must be within ${minY}..${minY + height - 1}.`);
}
