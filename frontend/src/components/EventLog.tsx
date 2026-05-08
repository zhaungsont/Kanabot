import { useEffect, useRef } from 'react';
import { EventLogEntry } from '../types';

interface EventLogProps {
  entries: EventLogEntry[];
}

const TYPE_COLOR: Record<EventLogEntry['type'], string> = {
  success: 'var(--color-success)',
  error: 'var(--color-error)',
  warning: 'var(--color-warning)',
  info: 'var(--color-info)',
};

const TYPE_PREFIX: Record<EventLogEntry['type'], string> = {
  success: '✓',
  error: '✗',
  warning: '⚠',
  info: '›',
};

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function EventLog({ entries }: EventLogProps) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [entries]);

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.dot} />
        <span style={styles.dot} />
        <span style={styles.dot} />
        <span style={styles.title}>Event Log</span>
      </div>
      <div style={styles.body}>
        {entries.length === 0 && (
          <span style={styles.empty}>Waiting for bot events...</span>
        )}
        {entries.map((entry, i) => (
          <div key={i} style={styles.line}>
            <span style={styles.time}>{formatTime(entry.timestamp)}</span>
            <span style={{ ...styles.prefix, color: TYPE_COLOR[entry.type] }}>
              {TYPE_PREFIX[entry.type]}
            </span>
            <span style={{ ...styles.message, color: TYPE_COLOR[entry.type] }}>
              {entry.message}
            </span>
          </div>
        ))}
        <div ref={bottomRef} />
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: 'var(--color-terminal-bg)',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    height: '100%',
    minHeight: '180px',
    boxShadow: 'var(--shadow-md)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '6px',
    padding: '0.6rem 0.9rem',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    background: 'rgba(0,0,0,0.2)',
    flexShrink: 0,
  },
  dot: {
    width: '10px',
    height: '10px',
    borderRadius: '50%',
    background: 'rgba(255,255,255,0.15)',
  },
  title: {
    color: 'rgba(255,255,255,0.4)',
    fontSize: '0.72rem',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.06em',
    marginLeft: '0.25rem',
  },
  body: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0.75rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '3px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
  },
  empty: {
    color: 'rgba(255,255,255,0.25)',
    fontStyle: 'italic',
  },
  line: {
    display: 'flex',
    gap: '0.5rem',
    alignItems: 'baseline',
  },
  time: {
    color: 'rgba(255,255,255,0.3)',
    flexShrink: 0,
    fontSize: '0.72rem',
  },
  prefix: {
    flexShrink: 0,
    fontWeight: 700,
  },
  message: {
    wordBreak: 'break-word' as const,
  },
};
