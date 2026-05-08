import { useNavigate } from 'react-router-dom';

export default function LandingPage() {
  const navigate = useNavigate();

  return (
    <div style={styles.page}>
      <div style={styles.hero}>
        <div style={styles.badge}>🤖 Bot-as-a-Service</div>
        <h1 style={styles.title}>Kanabot</h1>
        <p style={styles.tagline}>
          Spawn Minecraft helper bots into any server — straight from your browser.
        </p>
        <ul style={styles.featureList}>
          <li>⚡ Deploy in seconds — just enter a server IP</li>
          <li>💬 Mirror in-game chat in real time</li>
          <li>🏃 Follow & Guard commands</li>
          <li>🆓 Completely free</li>
        </ul>
        <button style={styles.cta} onClick={() => navigate('/dashboard')}>
          Launch Dashboard →
        </button>
      </div>

      <footer style={styles.footer}>
        <p>Kanabot MVP · Built with mineflayer + React</p>
      </footer>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--color-bg)',
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    padding: '2rem',
    gap: '2rem',
  },
  hero: {
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: '1.25rem',
    textAlign: 'center',
    maxWidth: '560px',
  },
  badge: {
    background: 'var(--color-accent)',
    color: 'var(--color-text)',
    fontWeight: 700,
    fontSize: '0.8rem',
    letterSpacing: '0.05em',
    padding: '0.35rem 1rem',
    borderRadius: '999px',
    textTransform: 'uppercase',
  },
  title: {
    fontSize: 'clamp(3rem, 8vw, 5rem)',
    fontWeight: 900,
    letterSpacing: '-0.03em',
    color: 'var(--color-text)',
    lineHeight: 1,
  },
  tagline: {
    fontSize: '1.2rem',
    color: 'var(--color-text-muted)',
    lineHeight: 1.6,
  },
  featureList: {
    listStyle: 'none',
    display: 'flex',
    flexDirection: 'column',
    gap: '0.5rem',
    alignItems: 'flex-start',
    background: 'var(--color-surface)',
    border: '2px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '1.25rem 1.75rem',
    fontSize: '0.95rem',
    width: '100%',
  },
  cta: {
    background: 'var(--color-accent)',
    color: 'var(--color-text)',
    border: 'none',
    borderRadius: 'var(--radius-md)',
    padding: '0.9rem 2.5rem',
    fontSize: '1.1rem',
    fontWeight: 800,
    cursor: 'pointer',
    transition: 'background 0.15s, transform 0.1s',
    boxShadow: '0 4px 0 var(--color-accent-dark)',
  },
  footer: {
    color: 'var(--color-text-muted)',
    fontSize: '0.8rem',
    textAlign: 'center',
  },
};
