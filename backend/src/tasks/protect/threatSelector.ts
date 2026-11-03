import type { Entity } from 'prismarine-entity';

export type Visibility = 'clear' | 'blocked' | 'unknown';
export interface ThreatCandidate {
  entity: Entity; distanceSquared: number; botDistanceSquared: number;
  confirmed: boolean; approaching: boolean; arrival: number; visibility: Visibility;
}
export function tier(candidate: ThreatCandidate): number {
  if (candidate.confirmed) return 0;
  if (candidate.visibility === 'clear' && candidate.distanceSquared <= 9) return 1;
  if (candidate.approaching || (candidate.visibility === 'clear' && /^(skeleton|stray|bogged|pillager|blaze|ghast|witch|breeze|drowned)$/.test(candidate.entity.name ?? ''))) return 2;
  return 3;
}
export function reason(candidate: ThreatCandidate): string {
  return ['confirmed recent damage', 'close with clear line of sight', 'approaching or visible ranged threat', 'nearby hostile; intent unconfirmed'][tier(candidate)];
}
export function compare(a: ThreatCandidate, b: ThreatCandidate): number {
  return tier(a) - tier(b) || a.distanceSquared - b.distanceSquared ||
    (a.arrival === b.arrival ? 0 : a.arrival - b.arrival) || a.botDistanceSquared - b.botDistanceSquared || a.entity.id - b.entity.id;
}
/** Pure retention policy; acquisition/release and feasibility are observer/runtime concerns. */
export function selectThreat(candidates: ThreatCandidate[], current: Entity | null, selectedAt: number, now: number): ThreatCandidate | null {
  const best = candidates.filter(c => c.entity === current || c.distanceSquared <= 100).reduce<ThreatCandidate | null>((best, c) => !best || compare(c, best) < 0 ? c : best, null);
  const retained = candidates.find(c => c.entity === current);
  if (!retained || !best || best.entity === current) return best;
  if (tier(best) < tier(retained)) return best;
  if (now - selectedAt < 1_000 || tier(best) > tier(retained) || best.distanceSquared > retained.distanceSquared * 0.75 ** 2) return retained;
  return best;
}
export const distanceSquared = (a: Entity['position'], b: Entity['position']): number =>
  (a.x - b.x) ** 2 + (a.y - b.y) ** 2 + (a.z - b.z) ** 2;
