import { useState, useEffect, useCallback, useRef } from 'react';
import { io, type Socket } from 'socket.io-client';
import { usePlayerList } from './usePlayerList';
import { createSessionHandle, SessionHandleStore } from '../services/sessionHandleStore';
import type { BotSessionInfo, BotSessionHandle, BotSessionSnapshot, SessionResult, ChatMessage, EventLogEntry, BotConfig, BotAction, ExcavateRegion, ArmorSlot, ArmorSlotId } from '../types';
import type { ServerToClientEvents, ClientToServerEvents } from '../../../shared/socketContracts.js';

const BACKEND_URL = import.meta.env['VITE_BACKEND_URL'] ?? 'http://localhost:3001';
const handleStore = new SessionHandleStore(() => window.localStorage, BACKEND_URL);
type AppSocket = Socket<ServerToClientEvents, ClientToServerEvents>;

export function useBotSession() {
  const socketRef = useRef<AppSocket | null>(null);
  const [handle, setHandle] = useState<BotSessionHandle | null>(() => handleStore.read());
  const handleRef = useRef(handle);
  const operation = useRef(0);
  const [connected, setConnected] = useState(false);
  const [botInfo, setBotInfo] = useState<BotSessionInfo | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);
  const [isRestoring, setIsRestoring] = useState(!!handle);
  const [armorItems, setArmorItems] = useState<ArmorSlot[]>([]);

  const forgetHandle = useCallback((id: string) => {
    if (handleRef.current?.sessionId !== id) return;
    handleStore.clear(id);
    handleRef.current = null;
    setHandle(null);
    setBotInfo(null);
    setArmorItems([]);
    setIsDeploying(false);
    setIsRestoring(false);
  }, []);

  const applySnapshot = useCallback((snapshot: BotSessionSnapshot) => {
    setBotInfo(snapshot.info);
    setArmorItems(snapshot.armor);
    setChatMessages(snapshot.chats);
    setEventLog(snapshot.events);
    setIsDeploying(snapshot.info.state === 'spawning');
    setIsRestoring(false);
    setDeployError(null);
  }, []);

  const resumeBot = useCallback(() => {
    const socket = socketRef.current;
    const saved = handleRef.current;
    if (!socket?.connected || !saved) { setIsRestoring(false); return; }
    const request = ++operation.current;
    setIsRestoring(true);
    setDeployError(null);
    socket.timeout(5_000).emit('bot:resume', saved, (error: Error | null, result?: SessionResult<BotSessionSnapshot>) => {
      if (socketRef.current !== socket || request !== operation.current) return;
      setIsRestoring(false);
      if (error || !result) { setDeployError('Could not reconnect to the bot. It may still be running; retry reconnecting.'); return; }
      if (!result.ok) {
        if (result.code === 'NOT_FOUND') forgetHandle(saved.sessionId);
        setDeployError(result.error);
        return;
      }
      applySnapshot(result.value);
    });
  }, [applySnapshot, forgetHandle]);

  useEffect(() => {
    const socket: AppSocket = io(BACKEND_URL, { autoConnect: false, transports: ['websocket', 'polling'] });
    socketRef.current = socket;
    socket.on('connect', () => { setConnected(true); resumeBot(); });
    socket.on('disconnect', () => {
      operation.current++;
      setConnected(false);
      setBotInfo(null);
      setArmorItems([]);
      setIsDeploying(false);
      setIsRestoring(!!handleRef.current);
    });
    socket.on('bot:state', (info) => {
      if (info.sessionId !== handleRef.current?.sessionId) return;
      setBotInfo(info);
      setIsDeploying(info.state === 'spawning');
    });
    socket.on('bot:removed', (id) => {
      if (id !== handleRef.current?.sessionId) return;
      operation.current++;
      forgetHandle(id);
    });
    socket.on('bot:chat', (message) => setChatMessages((previous) => [...previous.slice(-199), message]));
    socket.on('bot:event', (event) => setEventLog((previous) => [...previous.slice(-149), event]));
    socket.on('bot:error', (message) => { setDeployError(message); setIsDeploying(false); });
    socket.on('bot:armor', setArmorItems);
    socket.connect();
    return () => {
      operation.current++;
      socket.removeAllListeners();
      socket.disconnect(); // Detach the viewer; execution is owned by the backend.
      if (socketRef.current === socket) socketRef.current = null;
    };
  }, [forgetHandle, resumeBot]);

  const deployBot = useCallback((config: BotConfig) => {
    const socket = socketRef.current;
    if (!socket?.connected || handleRef.current) return;
    let next: BotSessionHandle;
    try {
      // A single saved bot per browser/backend is the current dashboard scope.
      if (handleStore.read()) { setDeployError('Another tab has saved a bot. Refresh to reconnect to it first.'); return; }
      next = createSessionHandle();
      handleStore.save(next);
    } catch { setDeployError('Browser storage and secure random IDs are required to safely reconnect to a bot.'); return; }
    handleRef.current = next;
    setHandle(next);
    const request = ++operation.current;
    setDeployError(null);
    setChatMessages([]);
    setEventLog([]);
    setBotInfo(null);
    setArmorItems([]);
    setIsDeploying(true);
    socket.timeout(5_000).emit('bot:create', config, next, (error: Error | null, result?: SessionResult<BotSessionSnapshot>) => {
      if (socketRef.current !== socket || request !== operation.current) return;
      setIsDeploying(false);
      if (error || !result) { setDeployError('Deployment acknowledgement missing. Reconnect to check whether the bot started.'); return; }
      if (!result.ok) {
        if (result.code === 'INVALID_REQUEST' || result.code === 'NOT_FOUND') forgetHandle(next.sessionId);
        setDeployError(result.error);
        return;
      }
      applySnapshot(result.value);
    });
  }, [applySnapshot, forgetHandle]);

  const disconnectBot = useCallback(() => {
    const socket = socketRef.current;
    const saved = handleRef.current;
    if (!socket?.connected || !saved) return;
    const request = ++operation.current;
    socket.timeout(5_000).emit('bot:disconnect', saved.sessionId, (error: Error | null, result?: SessionResult<null>) => {
      if (socketRef.current !== socket || request !== operation.current) return;
      if (error || !result) { setDeployError('Stop was not acknowledged. Reconnect to check the bot before retrying.'); return; }
      if (result.ok) forgetHandle(saved.sessionId);
      else setDeployError(result.error);
    });
  }, [forgetHandle]);

  const sendChat = useCallback((message: string) => {
    if (socketRef.current?.connected && handleRef.current) socketRef.current.emit('bot:chat', handleRef.current.sessionId, message);
  }, []);
  const performAction = useCallback((action: BotAction) => {
    if (socketRef.current?.connected && handleRef.current) socketRef.current.emit('bot:action', handleRef.current.sessionId, action);
  }, []);
  const excavate = useCallback((region: ExcavateRegion) => performAction({ type: 'excavate', region }), [performAction]);
  const unequipArmor = useCallback((slot: ArmorSlotId) => {
    if (socketRef.current?.connected && handleRef.current) socketRef.current.emit('bot:unequip', handleRef.current.sessionId, slot);
  }, []);
  const playerList = usePlayerList({
    socket: connected && !isRestoring ? socketRef.current : null,
    sessionId: handle?.sessionId ?? null,
    active: connected && !isRestoring && (botInfo?.state === 'idle' || botInfo?.state === 'task'),
  });
  return {
    playerList, connected, sessionId: handle?.sessionId ?? null, hasSavedSession: !!handle,
    botInfo, chatMessages, eventLog, deployError, isDeploying, isRestoring, armorItems,
    deployBot, resumeBot, disconnectBot, sendChat, performAction, excavate, unequipArmor,
  };
}
