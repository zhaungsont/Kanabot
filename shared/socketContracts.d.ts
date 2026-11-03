import type { ArmorSlotId, BotAction, BotConfig, BotSessionInfo, ArmorSlot, ChatMessage, EventLogEntry } from './botContracts.js';
import type { PlayerCommand, PlayerCommandResult, PlayerListSnapshot } from './playerContracts.js';
import type { BotSessionHandle, BotSessionSnapshot, SessionResult } from './sessionContracts.js';
import type { PlayerAccessSnapshot, PlayerAccessResult, PlayerRoleUpdate } from './accessContracts.js';

export interface ServerToClientEvents {
  'bot:access': (snapshot: PlayerAccessSnapshot) => void;
  'bot:removed': (sessionId: string) => void;
  'bot:state': (info: BotSessionInfo) => void;
  'bot:chat': (message: ChatMessage) => void;
  'bot:event': (entry: EventLogEntry) => void;
  'bot:error': (message: string) => void;
  'bot:armor': (slots: ArmorSlot[]) => void;
  'bot:players': (snapshot: PlayerListSnapshot) => void;
}

export interface ClientToServerEvents {
  'bot:access:get': (sessionId: string, callback: (result: PlayerAccessResult) => void) => void;
  'bot:access:update': (sessionId: string, update: PlayerRoleUpdate, callback: (result: PlayerAccessResult) => void) => void;
  'bot:create': (
    config: BotConfig,
    handle: BotSessionHandle,
    callback: (result: SessionResult<BotSessionSnapshot>) => void
  ) => void;
  'bot:resume': (handle: BotSessionHandle, callback: (result: SessionResult<BotSessionSnapshot>) => void) => void;
  'bot:disconnect': (sessionId: string, callback: (result: SessionResult<null>) => void) => void;
  'bot:chat': (sessionId: string, message: string) => void;
  'bot:action': (sessionId: string, action: BotAction) => void;
  'bot:unequip': (sessionId: string, slot: ArmorSlotId) => void;
  'bot:players:subscribe': (sessionId: string, enabled: boolean, callback: (result: PlayerCommandResult) => void) => void;
  'bot:playerAction': (sessionId: string, command: PlayerCommand, callback: (result: PlayerCommandResult) => void) => void;
}

export interface InterServerEvents {
  ping: () => void;
}

export interface SocketData {
  sessionId?: string;
}
