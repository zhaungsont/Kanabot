import type { BehaviorSettings } from '../../../shared/behaviorContracts.js';

export const defaultBehaviors = (): BehaviorSettings => ({ avoidDrowning: false, selfDefense: { enabled: false, mode: 'flight', durationSeconds: 10 } });
export const copySettings = (settings: BehaviorSettings): BehaviorSettings => ({ avoidDrowning: settings.avoidDrowning ?? false, selfDefense: { ...settings.selfDefense } });
export function validBehaviorSettings(value: unknown): value is BehaviorSettings {
  if (!value || typeof value !== 'object') return false;
  const s = value as Record<string, unknown>;
  if (Object.keys(s).some(k => !['autoEat', 'avoidDrowning', 'selfDefense'].includes(k)) ||
    (s.autoEat !== undefined && typeof s.autoEat !== 'boolean') || (s.avoidDrowning !== undefined && typeof s.avoidDrowning !== 'boolean') || !s.selfDefense || typeof s.selfDefense !== 'object') return false;
  const d = s.selfDefense as Record<string, unknown>;
  return Object.keys(d).every(k => ['enabled', 'mode', 'durationSeconds'].includes(k)) && typeof d.enabled === 'boolean' &&
    (d.mode === 'fight' || d.mode === 'flight') && Number.isInteger(d.durationSeconds) && Number(d.durationSeconds) >= 1 && Number(d.durationSeconds) <= 120;
}
