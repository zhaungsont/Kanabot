import { useNavigate } from 'react-router-dom';
import { useBotSession } from '../hooks/useBotSession';
import BotDeployForm from '../components/BotDeployForm';
import ChatBox from '../components/ChatBox';
import EventLog from '../components/EventLog';
import ActionPanel from '../components/ActionPanel';
import AdBanner from '../components/AdBanner';

export default function DashboardPage() {
  const navigate = useNavigate();
  const {
    connected,
    botInfo,
    chatMessages,
    eventLog,
    deployError,
    isDeploying,
    deployBot,
    disconnectBot,
    sendChat,
    performAction,
  } = useBotSession();

  const isActive = botInfo !== null && (botInfo.state === 'idle' || botInfo.state === 'task');
  const isSpawning = isDeploying || botInfo?.state === 'spawning';
  const showPanel = isActive || isSpawning || (botInfo?.state === 'dead');
  const chatEnabled = isActive;

  return (
    <div style={styles.page}>
      {/* Top Ad Banner */}
      <AdBanner position="top" />

      {/* Header */}
      <header style={styles.header}>
        <button style={styles.backBtn} onClick={() => navigate('/')}>← Home</button>
        <div style={styles.headerTitle}>
          <span style={styles.logo}>🤖</span>
          <h1 style={styles.title}>Kanabot Dashboard</h1>
        </div>
        <div style={styles.connectionBadge}>
          <span
            style={{
              ...styles.connDot,
              background: connected ? 'var(--color-success)' : 'var(--color-error)',
            }}
          />
          <span style={styles.connLabel}>{connected ? 'Connected' : 'Disconnected'}</span>
        </div>
      </header>

      {/* Main Content */}
      <main style={styles.main}>
        {/* Left Column */}
        <div style={styles.leftCol}>
          {!showPanel ? (
            <BotDeployForm
              onDeploy={deployBot}
              isDeploying={isSpawning}
              error={deployError}
            />
          ) : (
            botInfo && (
              <ActionPanel
                botInfo={botInfo}
                onAction={performAction}
                onDisconnect={disconnectBot}
              />
            )
          )}

          {isSpawning && !botInfo && (
            <div style={styles.spawningCard}>
              <div style={styles.spinner} />
              <p>Connecting to server...</p>
            </div>
          )}
        </div>

        {/* Right Column */}
        <div style={styles.rightCol}>
          <div style={styles.eventLogWrapper}>
            <EventLog entries={eventLog} />
          </div>
          <div style={styles.chatWrapper}>
            <ChatBox
              messages={chatMessages}
              onSend={sendChat}
              disabled={!chatEnabled}
            />
          </div>
        </div>
      </main>

      {/* Bottom Ad Banner */}
      <AdBanner position="bottom" />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: {
    minHeight: '100vh',
    background: 'var(--color-bg)',
    display: 'flex',
    flexDirection: 'column',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    padding: '0.85rem 1.5rem',
    borderBottom: '2px solid var(--color-border)',
    background: 'var(--color-surface)',
    flexShrink: 0,
    flexWrap: 'wrap' as const,
    gap: '0.75rem',
  },
  backBtn: {
    background: 'transparent',
    border: '1.5px solid var(--color-border)',
    color: 'var(--color-text-muted)',
    borderRadius: 'var(--radius-sm)',
    padding: '0.4rem 0.85rem',
    fontSize: '0.85rem',
    cursor: 'pointer',
    fontWeight: 600,
  },
  headerTitle: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
  },
  logo: {
    fontSize: '1.5rem',
  },
  title: {
    fontSize: '1.15rem',
    fontWeight: 800,
    color: 'var(--color-text)',
  },
  connectionBadge: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.4rem',
    background: 'var(--color-surface-2)',
    border: '1px solid var(--color-border)',
    borderRadius: '999px',
    padding: '0.3rem 0.85rem',
    fontSize: '0.78rem',
    fontWeight: 600,
    color: 'var(--color-text-muted)',
  },
  connDot: {
    width: '8px',
    height: '8px',
    borderRadius: '50%',
  },
  connLabel: {
    fontSize: '0.78rem',
  },
  main: {
    flex: 1,
    display: 'grid',
    gridTemplateColumns: 'minmax(280px, 380px) 1fr',
    gap: '1rem',
    padding: '1rem 1.5rem',
    alignItems: 'start',
    maxWidth: '1400px',
    width: '100%',
    margin: '0 auto',
  },
  leftCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    position: 'sticky' as const,
    top: '1rem',
  },
  rightCol: {
    display: 'flex',
    flexDirection: 'column',
    gap: '1rem',
    height: 'calc(100vh - 180px)',
    minHeight: '400px',
  },
  eventLogWrapper: {
    flex: 1,
    minHeight: '200px',
  },
  chatWrapper: {
    flex: 1.2,
    minHeight: '220px',
  },
  spawningCard: {
    background: 'var(--color-surface)',
    border: '2px solid var(--color-border)',
    borderRadius: 'var(--radius-md)',
    padding: '1.5rem',
    display: 'flex',
    alignItems: 'center',
    gap: '0.75rem',
    color: 'var(--color-text-muted)',
    fontSize: '0.9rem',
  },
  spinner: {
    width: '20px',
    height: '20px',
    border: '2.5px solid var(--color-border)',
    borderTop: '2.5px solid var(--color-accent)',
    borderRadius: '50%',
    animation: 'spin 0.8s linear infinite',
    flexShrink: 0,
  },
};
