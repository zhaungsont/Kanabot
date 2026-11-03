import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { ClientToServerEvents, ServerToClientEvents } from '../../../shared/socketContracts.js';
import type { PlayerAccessSnapshot, PlayerAccessResult, PlayerRole } from '../types';

export function usePlayerRoles(socket: Socket<ServerToClientEvents, ClientToServerEvents> | null, sessionId: string | null) {
  const [snapshot, setSnapshot] = useState<PlayerAccessSnapshot | null>(null);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const generation = useRef(0);
  const receive = useCallback((value: PlayerAccessSnapshot) => {
    setSnapshot((previous) => previous?.sessionId === value.sessionId && previous.revision > value.revision ? previous : value);
  }, []);

  useEffect(() => {
    const current = ++generation.current;
    setSnapshot(null); setPending(false); setNotice(null);
    if (!socket || !sessionId) return;
    const onAccess = (value: PlayerAccessSnapshot) => { if (value.sessionId === sessionId) receive(value); };
    socket.on('bot:access', onAccess);
    socket.timeout(5_000).emit('bot:access:get', sessionId, (error: Error | null, result?: PlayerAccessResult) => {
      if (generation.current !== current) return;
      if (error || !result) setNotice('Could not load player roles. Reconnect to try again.');
      else if (result.ok) receive(result.value);
      else setNotice(result.error);
    });
    return () => { generation.current++; socket.off('bot:access', onAccess); };
  }, [socket, sessionId, receive]);

  const updateRole = useCallback((username: string, role: PlayerRole | null) => {
    if (!socket?.connected || !sessionId || !snapshot || pending) return;
    const current = generation.current;
    setPending(true); setNotice(null);
    socket.timeout(5_000).emit('bot:access:update', sessionId, { username, role, expectedRevision: snapshot.revision },
      (error: Error | null, result?: PlayerAccessResult) => {
        if (generation.current !== current) return;
        setPending(false);
        if (error || !result) { setNotice('Update not acknowledged. Reconnect to check assignments before retrying.'); return; }
        if (result.ok) { receive(result.value); setNotice(`Role ${role === null ? 'removed' : 'saved'} for ${username.trim()}. Existing tasks are unchanged.`); }
        else {
          setNotice(result.error);
          if (result.code === 'CONFLICT') socket.timeout(5_000).emit('bot:access:get', sessionId, (reloadError: Error | null, latest?: PlayerAccessResult) => {
            if (generation.current === current && !reloadError && latest?.ok) receive(latest.value);
          });
        }
      });
  }, [socket, sessionId, snapshot, pending, receive]);
  return { snapshot, pending, notice, updateRole, connected: !!socket?.connected };
}
