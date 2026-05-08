import { useState, FormEvent } from 'react';
import { BotConfig } from '../types';

interface BotDeployFormProps {
  onDeploy: (config: BotConfig) => void;
  isDeploying: boolean;
  error: string | null;
}

export default function BotDeployForm({ onDeploy, isDeploying, error }: BotDeployFormProps) {
  const [host, setHost] = useState('');
  const [port, setPort] = useState('');
  const [botName, setBotName] = useState('mc_bot');
  const [version, setVersion] = useState('');

  const handleSubmit = (e: FormEvent) => {
    e.preventDefault();
    if (!host.trim()) return;
    const parsedPort = parseInt(port, 10);
    onDeploy({
      serverHost: host.trim(),
      serverPort: port.trim() && !isNaN(parsedPort) ? parsedPort : undefined,
      botName: botName.trim() || 'mc_bot',
      version: version.trim() || undefined,
    });
  };

  return (
    <div style={styles.card}>
      <h2 style={styles.heading}>Deploy a Bot</h2>
      <p style={styles.sub}>Enter your Minecraft server details to spawn a bot.</p>

      <form onSubmit={handleSubmit} style={styles.form}>
        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>Server</legend>
          <div style={styles.row}>
            <label style={styles.label}>
              <span>Server IP <span style={styles.required}>*</span></span>
              <input
                style={styles.input}
                type="text"
                placeholder="play.example.com"
                value={host}
                onChange={(e) => setHost(e.target.value)}
                disabled={isDeploying}
                required
              />
            </label>
            <label style={{ ...styles.label, flex: '0 0 120px' }}>
              <span>Port <span style={styles.hint}>(optional)</span></span>
              <input
                style={styles.input}
                type="number"
                placeholder="default"
                value={port}
                onChange={(e) => setPort(e.target.value)}
                disabled={isDeploying}
                min={1}
                max={65535}
              />
            </label>
          </div>
        </fieldset>

        <fieldset style={styles.fieldset}>
          <legend style={styles.legend}>Bot</legend>
          <div style={styles.row}>
            <label style={styles.label}>
              <span>Bot Name</span>
              <input
                style={styles.input}
                type="text"
                placeholder="mc_bot"
                value={botName}
                onChange={(e) => setBotName(e.target.value)}
                disabled={isDeploying}
                maxLength={16}
              />
            </label>
            <label style={styles.label}>
              <span>MC Version <span style={styles.hint}>(optional — auto-detect)</span></span>
              <input
                style={styles.input}
                type="text"
                placeholder="e.g. 1.21.1"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={isDeploying}
              />
            </label>
          </div>
        </fieldset>

        {error && <div style={styles.error}>⚠ {error}</div>}

        <button style={styles.button} type="submit" disabled={isDeploying || !host.trim()}>
          {isDeploying ? (
            <span>⏳ Connecting...</span>
          ) : (
            <span>🚀 Deploy Bot</span>
          )}
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  card: {
    background: 'var(--color-surface)',
    border: '2px solid var(--color-border)',
    borderRadius: 'var(--radius-lg)',
    padding: '2rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '1.25rem',
  },
  heading: {
    fontSize: '1.4rem',
    fontWeight: 800,
    color: 'var(--color-text)',
  },
  sub: {
    color: 'var(--color-text-muted)',
    fontSize: '0.9rem',
    marginTop: '-0.75rem',
  },
  form: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
  },
  fieldset: {
    border: '1.5px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.75rem',
  },
  legend: {
    fontWeight: 700,
    fontSize: '0.8rem',
    letterSpacing: '0.06em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
    padding: '0 0.4rem',
  },
  row: {
    display: 'flex',
    gap: '0.75rem',
    flexWrap: 'wrap' as const,
  },
  label: {
    display: 'flex',
    flexDirection: 'column',
    gap: '0.35rem',
    flex: 1,
    fontSize: '0.85rem',
    fontWeight: 600,
    color: 'var(--color-text)',
    minWidth: '140px',
  },
  input: {
    padding: '0.6rem 0.85rem',
    borderRadius: 'var(--radius-sm)',
    border: '1.5px solid var(--color-border)',
    background: '#fff',
    fontSize: '0.9rem',
    color: 'var(--color-text)',
    fontFamily: 'inherit',
    outline: 'none',
    transition: 'border-color 0.15s',
  },
  required: {
    color: 'var(--color-error)',
  },
  hint: {
    fontWeight: 400,
    color: 'var(--color-text-muted)',
    fontSize: '0.78rem',
  },
  error: {
    background: '#FFF0F0',
    border: '1px solid var(--color-error)',
    color: 'var(--color-error)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.6rem 1rem',
    fontSize: '0.85rem',
  },
  button: {
    background: 'var(--color-accent)',
    color: 'var(--color-text)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '0.85rem',
    fontSize: '1rem',
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'background 0.15s',
    boxShadow: '0 3px 0 var(--color-accent-dark)',
  },
};
