import { useState, useEffect } from 'react';
import { BotSessionInfo, BotAction, ExcavateRegion } from '../types';

interface ActionPanelProps {
  botInfo: BotSessionInfo;
  onAction: (action: BotAction) => void;
  onExcavate: (region: ExcavateRegion) => void;
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

const TASK_ICON: Record<string, string> = {
  follow: '🏃',
  guard: '🛡',
  excavate: '⛏',
};

function CoordInput({
  label,
  value,
  onChange,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  disabled: boolean;
}) {
  return (
    <label style={styles.coordLabel}>
      <span style={styles.coordAxisLabel}>{label}</span>
      <input
        style={styles.coordInput}
        type="number"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        disabled={disabled}
        placeholder="0"
      />
    </label>
  );
}

export default function ActionPanel({ botInfo, onAction, onExcavate, onDisconnect }: ActionPanelProps) {
  const [followTarget, setFollowTarget] = useState('');
  const [guardTarget, setGuardTarget] = useState('');
  const [dig, setDig] = useState({ x1: '', y1: '', z1: '', x2: '', y2: '', z2: '' });
  const uptime = useUptime(botInfo.spawnedAt);

  const isIdle = botInfo.state === 'idle';
  const isInTask = botInfo.state === 'task';
  const isActive = isIdle || isInTask;

  const handleFollow = () => {
    if (!followTarget.trim()) return;
    onAction({ type: 'follow', target: followTarget.trim() });
  };

  const handleGuard = () => {
    if (!guardTarget.trim()) return;
    onAction({ type: 'guard', target: guardTarget.trim() });
  };

  const digCoords = [dig.x1, dig.y1, dig.z1, dig.x2, dig.y2, dig.z2].map(Number);
  const digValid = digCoords.every((n) => !isNaN(n)) && [dig.x1, dig.y1, dig.z1, dig.x2, dig.y2, dig.z2].every((s) => s !== '');

  const handleExcavate = () => {
    if (!digValid) return;
    const [x1, y1, z1, x2, y2, z2] = digCoords as [number, number, number, number, number, number];
    onExcavate({ x1, y1, z1, x2, y2, z2 });
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
              {TASK_ICON[botInfo.currentTask] ?? '⚙'} {botInfo.currentTask}
              {botInfo.taskTarget && <> <strong>{botInfo.taskTarget}</strong></>}
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

        {/* Follow */}
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

        {/* Guard */}
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

        {/* Excavate */}
        <div style={styles.excavateGroup}>
          <span style={styles.excavateTitle}>⛏ Excavate Region</span>
          <div style={styles.coordRow}>
            <span style={styles.coordCornerLabel}>From</span>
            <CoordInput label="X" value={dig.x1} onChange={(v) => setDig((d) => ({ ...d, x1: v }))} disabled={!isIdle} />
            <CoordInput label="Y" value={dig.y1} onChange={(v) => setDig((d) => ({ ...d, y1: v }))} disabled={!isIdle} />
            <CoordInput label="Z" value={dig.z1} onChange={(v) => setDig((d) => ({ ...d, z1: v }))} disabled={!isIdle} />
          </div>
          <div style={styles.coordRow}>
            <span style={styles.coordCornerLabel}>To</span>
            <CoordInput label="X" value={dig.x2} onChange={(v) => setDig((d) => ({ ...d, x2: v }))} disabled={!isIdle} />
            <CoordInput label="Y" value={dig.y2} onChange={(v) => setDig((d) => ({ ...d, y2: v }))} disabled={!isIdle} />
            <CoordInput label="Z" value={dig.z2} onChange={(v) => setDig((d) => ({ ...d, z2: v }))} disabled={!isIdle} />
          </div>
          <button
            style={{ ...styles.actionBtn, background: '#8B4513', color: '#fff', alignSelf: 'flex-start', marginTop: '0.25rem' }}
            onClick={handleExcavate}
            disabled={!isIdle || !digValid}
          >
            Start Excavation
          </button>
        </div>

        {/* Stop button */}
        {isInTask && (
          <button
            style={{ ...styles.actionBtn, background: '#FF9800', color: '#fff', alignSelf: 'flex-end' }}
            onClick={() => onAction({ type: 'stop' })}
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
  excavateGroup: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '0.4rem',
    padding: '0.65rem',
    background: 'var(--color-surface-2)',
    border: '1.5px solid var(--color-border)',
    borderRadius: 'var(--radius-sm)',
  },
  excavateTitle: {
    fontSize: '0.8rem',
    fontWeight: 600,
    color: 'var(--color-text)',
  },
  coordRow: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.35rem',
  },
  coordCornerLabel: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: 'var(--color-text-muted)',
    width: '30px',
    flexShrink: 0,
  },
  coordLabel: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.2rem',
    flex: 1,
  },
  coordAxisLabel: {
    fontSize: '0.7rem',
    fontWeight: 700,
    color: 'var(--color-text-muted)',
    width: '10px',
    flexShrink: 0,
  },
  coordInput: {
    flex: 1,
    padding: '0.35rem 0.4rem',
    borderRadius: 'var(--radius-sm)',
    border: '1.5px solid var(--color-border)',
    fontSize: '0.8rem',
    fontFamily: 'var(--font-mono)',
    outline: 'none',
    background: '#fff',
    color: 'var(--color-text)',
    minWidth: 0,
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
