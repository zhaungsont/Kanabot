import type { ExcavateRegion } from './botContracts.js';
import type { TaskOutcome } from './taskContracts.js';

export type ExcavationDirection = 'east' | 'west' | 'up' | 'down' | 'south' | 'north';
export interface ExcavationInput {
  origin: { x: number; y: number; z: number };
  sizes: { direction: ExcavationDirection; count: number }[];
}
export type ExcavationRequest =
  | { type: 'prepare'; input: ExcavationInput }
  | { type: 'confirm'; planId: string }
  | { type: 'preview' | 'cancel' | 'help' }
  | { type: 'status' | 'stop'; taskId: string };
export interface ExcavationPlan {
  planId: string;
  bounds: ExcavateRegion;
  volume: number;
  dimension: string;
  staging: { x: number; y: number; z: number };
  observedAt: string;
  expiresAt: string;
  known: { solid: number; clear: number; unknown: number };
  policy: 'external-stance-v1';
}
export interface ExcavationStatus {
  taskId: string;
  phase: 'running' | 'stopping' | 'cleanup-failed' | 'finished';
  checked: number;
  total: number;
  outcome?: TaskOutcome;
}
export type ExcavationResult = { ok: false; error: string } | {
  ok: true;
  message: string;
  plan?: ExcavationPlan;
  task?: ExcavationStatus;
};
