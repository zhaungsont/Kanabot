import { useCallback, useEffect, useRef, useState } from 'react';
import type { Socket } from 'socket.io-client';
import type { PlayerCommand, PlayerCommandResult, PlayerListSnapshot } from '../types';

interface Options {
  socket: Socket | null;
  sessionId: string | null;
  active: boolean;
}

export function usePlayerList({ socket, sessionId, active }: Options) {
  const [enabled, setEnabled] = useState(false);
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden');
  const [snapshot, setSnapshot] = useState<PlayerListSnapshot | null>(null);
  const [notice, setNotice] = useState<{ error: boolean; text: string } | null>(null);
  const [pending, setPending] = useState(false);
  const generation = useRef(0);

  useEffect(() => {
    const onVisibility = () => setVisible(document.visibilityState !== 'hidden');
    document.addEventListener('visibilitychange', onVisibility);
    return () => document.removeEventListener('visibilitychange', onVisibility);
  }, []);

  useEffect(() => {
    generation.current++;
    setSnapshot(null);
    setNotice(null);
    setPending(false);
    return () => { generation.current++; };
  }, [socket, sessionId, active]);

  useEffect(() => {
    if (!socket || !sessionId || !active || !enabled || !visible) return;
    let disposed = false;
    const receive = (value: PlayerListSnapshot) => {
      if (!disposed && value.sessionId === sessionId) setSnapshot(value);
    };
    socket.on('bot:players', receive);
    socket.timeout(5_000).emit('bot:players:subscribe', sessionId, true,
      (error: Error | null, result?: PlayerCommandResult) => {
        if (disposed) return;
        if (error || !result?.ok) {
          setNotice({ error: true, text: result && !result.ok ? result.error : 'Could not subscribe to the player list.' });
        }
      });
    return () => {
      disposed = true;
      socket.off('bot:players', receive);
      if (socket.connected) socket.emit('bot:players:subscribe', sessionId, false, () => {});
      setSnapshot(null);
    };
  }, [socket, sessionId, active, enabled, visible]);

  const sendCommand = useCallback((command: PlayerCommand): Promise<PlayerCommandResult> => {
    if (!socket?.connected || !sessionId || !active) {
      return Promise.resolve({ ok: false, error: 'The bot is not connected.' });
    }
    const current = generation.current;
    setPending(true);
    setNotice(null);
    return new Promise((resolve) => {
      socket.timeout(5_000).emit('bot:playerAction', sessionId, command,
        (error: Error | null, result?: PlayerCommandResult) => {
          const outcome: PlayerCommandResult = error || !result
            ? { ok: false, error: 'No acknowledgement received. The command may have been accepted; check the event log before retrying.' }
            : result;
          if (generation.current === current) {
            setPending(false);
            setNotice({
              error: !outcome.ok,
              text: !outcome.ok ? outcome.error : command.type === 'whisper'
                ? `Whisper submitted to ${command.target}. Delivery depends on the server's /tell support.`
                : `${command.type === 'follow' ? 'Follow' : 'Attack'} accepted for ${command.target}.`,
            });
          }
          resolve(outcome);
        });
    });
  }, [socket, sessionId, active]);

  return { enabled, setEnabled, visible, snapshot, notice, pending, sendCommand };
}
