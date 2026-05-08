import { useState, useEffect, useCallback, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import { BotSessionInfo, ChatMessage, EventLogEntry, BotConfig } from '../types';

const BACKEND_URL = import.meta.env['VITE_BACKEND_URL'] ?? 'http://localhost:3001';
const MAX_CHAT_MESSAGES = 200;
const MAX_EVENT_LOG = 150;

export function useBotSession() {
  const socketRef = useRef<Socket | null>(null);

  const [connected, setConnected] = useState(false);
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [botInfo, setBotInfo] = useState<BotSessionInfo | null>(null);
  const [chatMessages, setChatMessages] = useState<ChatMessage[]>([]);
  const [eventLog, setEventLog] = useState<EventLogEntry[]>([]);
  const [deployError, setDeployError] = useState<string | null>(null);
  const [isDeploying, setIsDeploying] = useState(false);

  useEffect(() => {
    const socket = io(BACKEND_URL, { transports: ['websocket', 'polling'] });
    socketRef.current = socket;

    socket.on('connect', () => setConnected(true));
    socket.on('disconnect', () => setConnected(false));

    socket.on('bot:state', (info: BotSessionInfo) => {
      setBotInfo(info);
      setIsDeploying(info.state === 'spawning');
    });

    socket.on('bot:chat', (msg: ChatMessage) => {
      setChatMessages((prev) => [...prev.slice(-(MAX_CHAT_MESSAGES - 1)), msg]);
    });

    socket.on('bot:event', (entry: EventLogEntry) => {
      setEventLog((prev) => [...prev.slice(-(MAX_EVENT_LOG - 1)), entry]);
    });

    socket.on('bot:error', (message: string) => {
      setDeployError(message);
      setIsDeploying(false);
    });

    return () => {
      socket.disconnect();
    };
  }, []);

  const deployBot = useCallback((config: BotConfig) => {
    const socket = socketRef.current;
    if (!socket) return;

    setDeployError(null);
    setChatMessages([]);
    setEventLog([]);
    setBotInfo(null);
    setIsDeploying(true);

    socket.emit(
      'bot:create',
      config,
      (id: string | null, error?: string) => {
        if (error || !id) {
          setDeployError(error ?? 'Unknown error.');
          setIsDeploying(false);
          return;
        }
        setSessionId(id);
      }
    );
  }, []);

  const disconnectBot = useCallback(() => {
    const socket = socketRef.current;
    if (!socket || !sessionId) return;
    socket.emit('bot:disconnect', sessionId);
    setSessionId(null);
    setBotInfo(null);
  }, [sessionId]);

  const sendChat = useCallback(
    (message: string) => {
      const socket = socketRef.current;
      if (!socket || !sessionId) return;
      socket.emit('bot:chat', sessionId, message);
    },
    [sessionId]
  );

  const performAction = useCallback(
    (type: 'follow' | 'guard' | 'stop', target?: string) => {
      const socket = socketRef.current;
      if (!socket || !sessionId) return;
      socket.emit('bot:action', sessionId, { type, target });
    },
    [sessionId]
  );

  return {
    connected,
    sessionId,
    botInfo,
    chatMessages,
    eventLog,
    deployError,
    isDeploying,
    deployBot,
    disconnectBot,
    sendChat,
    performAction,
  };
}
