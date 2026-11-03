import type { ArmorSlot, BotSessionInfo, ChatMessage, EventLogEntry } from './botContracts.js';
import type { PlayerAccessSnapshot } from './accessContracts.js';

/** A temporary local capability, to be replaced by account ownership in the cloud. */
export interface BotSessionHandle { sessionId: string; accessToken: string; }
export type SessionResult<T> = { ok: true; value: T } | {
  ok: false;
  code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID_REQUEST' | 'UNAVAILABLE';
  error: string;
};
export interface BotSessionSnapshot {
  access: PlayerAccessSnapshot;
  info: BotSessionInfo;
  armor: ArmorSlot[];
  chats: ChatMessage[];
  events: EventLogEntry[];
}
