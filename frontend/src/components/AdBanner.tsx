interface AdBannerProps {
  position?: 'top' | 'bottom';
}

export default function AdBanner({ position = 'top' }: AdBannerProps) {
  return (
    <div style={{ ...styles.banner, borderRadius: position === 'top' ? '0 0 var(--radius-md) var(--radius-md)' : 'var(--radius-md) var(--radius-md) 0 0' }}>
      <span style={styles.label}>Advertisement</span>
      <span style={styles.placeholder}>[ Google AdSense — 728×90 ]</span>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  banner: {
    width: '100%',
    height: '60px',
    background: 'var(--color-surface-2)',
    border: '1.5px dashed var(--color-border)',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
    gap: '0.75rem',
    flexShrink: 0,
  },
  label: {
    fontSize: '0.65rem',
    fontWeight: 700,
    letterSpacing: '0.08em',
    textTransform: 'uppercase',
    color: 'var(--color-text-muted)',
  },
  placeholder: {
    fontSize: '0.75rem',
    color: 'var(--color-text-muted)',
    fontFamily: 'var(--font-mono)',
  },
};
