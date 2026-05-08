import { useState, useEffect } from 'react';
import { BotSessionInfo } from '../types';

interface ActionPanelProps {
  botInfo: BotSessionInfo;
  onAction: (type: 'follow' | 'guard' | 'stop', target?: string) => void;
  onDisconnect: () => void;
}

function useUptime(spawnedAt: Date | null): string {
  const [secs, setSecs] = useState(0);

  useEffect(() => {
    if (!spawnedAt) return;
    const update = () =>
      setSecs(Math.floor((Date.now() - new Date(spawnedAt).getTime()) / 1000));
    update();
    const id = setInterval(update, 1000);
    return () => clearInterval(id);
  }, [spawnedAt]);

  if (!spawnedAt) return '00:00:00';
  const h = String(Math.floor(secs / 3600)).padStart(2, '0');
  const m = String(Math.floor((secs % 3600) / 60)).padStart(2, '0');
  const s = String(secs % 60).padStart(2, '0');
  return `${h}:${m}:${s}`;
}

export default function ActionPanel({ botInfo, onAction, onDisconnect }: ActionPanelProps) {
  const [followTarget, setFollowTarget] = useState('');
  const [guardTarget, setGuardTarget] = useState('');
  const uptime = useUptime(botInfo.spawnedAt);

  const isIdle = botInfo.state === 'idle';
  const isInTask = botInfo.state === 'task';
  const isActive = isIdle || isInTask;

  const handleFollow = () => {
    if (!followTarget.trim()) return;
    onAction('follow', followTarget.trim());
  };

  const handleGuard = () => {
    if (!guardTarget.trim()) return;
    onAction('guard', guardTarget.trim());
  };

  return (
    <div style={styles.container}>
      {/* Status Bar */}
      <div style={styles.statusBar}>
        <div style={styles.statusLeft}>
          <span style={{ ...styles.stateDot, background: STATE_COLORS[botInfo.state] }} />
          <span style={styles.stateName}>{botInfo.state.toUpperCase()}</span>
          {botInfo.currentTask && (
            <span style={styles.taskBadge}>
              {botInfo.currentTask === 'follow' ? '🏃' : '🛡'} {botInfo.currentTask}{' '}
              <strong>{botInfo.taskTarget}</strong>
            </span>
          )}
        </div>
        <div style={styles.uptimeDisplay}>
          ⏱ {uptime}
        </div>
      </div>

      {/* Bot Info */}
      <div style={styles.infoRow}>
        <span style={styles.infoChip}>
          🤖 <strong>{botInfo.config.botName}</strong>
        </span>
        <span style={styles.infoChip}>
          🌐 {botInfo.config.serverHost}:{botInfo.config.serverPort}
        </span>
      </div>

      {/* Actions */}
      <div style={styles.actions}>
        <div style={styles.actionGroup}>
          <label style={styles.actionLabel}>
            <span>🏃 Follow Player</span>
            <input
              style={styles.actionInput}
              type="text"
              placeholder="Player name"
              value={followTarget}
              onChange={(e) => setFollowTarget(e.target.value)}
              disabled={!isIdle}
            />
          </label>
          <button
            style={{ ...styles.actionBtn, background: '#4CAF50', color: '#fff' }}
            onClick={handleFollow}
            disabled={!isIdle || !followTarget.trim()}
          >
            Follow
          </button>
        </div>

        <div style={styles.actionGroup}>
          <label style={styles.actionLabel}>
            <span>🛡 Guard Player</span>
            <input
              style={styles.actionInput}
              type="text"
              placeholder="Player name"
              value={guardTarget}
              onChange={(e) => setGuardTarget(e.target.value)}
              disabled={!isIdle}
            />
          </label>
          <button
            style={{ ...styles.actionBtn, background: '#2196F3', color: '#fff' }}
            onClick={handleGuard}
            disabled={!isIdle || !guardTarget.trim()}
          >
            Guard
          </button>
        </div>

        {isInTask && (
          <button
            style={{ ...styles.actionBtn, background: '#FF9800', color: '#fff', alignSelf: 'flex-end' }}
            onClick={() => onAction('stop')}
          >
            ⏹ Stop Task
          </button>
        )}
      </div>

      {/* Disconnect */}
      {isActive && (
        <button style={styles.disconnectBtn} onClick={onDisconnect}>
          Disconnect Bot
        </button>
      )}
    </div>
  );
}

const STATE_COLORS: Record<string, string> = {
  disconnected: '#888',
  spawning: '#FFD700',
  idle: '#4CAF50',
  task: '#2196F3',
  dead: '#FF6B6B',
};

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'var(--color-surface)',
    border: '2px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '1.25rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  statusBar: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: '0.5rem',
    flexWrap: 'wrap' as const,
  },
  statusLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  stateDot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    flexShrink: 0,
  },
  stateName: {
    fontWeight: 800,
    fontSize: '0.8rem',
    letterSpacing: '0.08em',
    color: 'var(--color-text)',
  },
  taskBadge: {
    background: 'var(--color-accent-light)',
    border: '1px solid var(--color-accent)',
    borderRadius: '999px',
    padding: '0.2rem 0.65rem',
    fontSize: '0.75rem',
    color: 'var(--color-text)',
  },
  uptimeDisplay: {
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85rem',
    fontWeight: 700,
    color: 'var(--color-text-muted)',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.3rem 0.65rem',
  },
  infoRow: {
    display: 'flex',
    gap: '0.5rem',
    flexWrap: 'wrap' as const,
  },
  infoChip: {
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.25rem 0.65rem',
    fontSize: '0.8rem',
    color: 'var(--color-text-muted)',
  },
  actions: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.65rem',
  },
  actionGroup: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'flex-end',
  },
  actionLabel: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    gap: '0.3rem',
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--color-text)',
  },
  actionInput: {
    padding: '0.5rem 0.75rem',
    borderRadius: 'var(--radius-sm)',
    border: '1.5px solid var(--color-border)',
    fontSize: '0.85rem',
    fontFamily: 'inherit',
    outline: 'none',
    background: '#fff',
    color: 'var(--color-text)',
  },
  actionBtn: {
    padding: '0.5rem 1rem',
    border: 'none',
    borderRadius: 'var(--radius-sm)',
    fontWeight: 700,
    fontSize: '0.85rem',
    cursor: 'pointer',
    whiteSpace: 'nowrap' as const,
    flexShrink: 0,
    transition: 'opacity 0.15s',
  },
  disconnectBtn: {
    background: 'transparent',
    border: '1.5px solid var(--color-error)',
    color: 'var(--color-error)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.5rem 1rem',
    fontWeight: 700,
    fontSize: '0.85rem',
    cursor: 'pointer',
    alignSelf: 'flex-start',
    transition: 'background 0.15s',
  },
};
