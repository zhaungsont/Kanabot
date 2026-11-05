interface Props {
  connected: boolean;
  restoring: boolean;
  deploying: boolean;
  attached: boolean;
  error: string | null;
  onResume: () => void;
  onDisconnect: () => void;
}

/** Deployment lifetime controls stay available independently of gameplay state. */
export default function SessionControls({ connected, restoring, deploying, attached, error, onResume, onDisconnect }: Props) {
  return <div style={{ gridColumn: '1 / -1' }} role="status">
    {restoring ? 'Reconnecting to your bot…' : 'Your bot runs independently of this page. Use Disconnect Bot to stop it.'}
    {error && <p role="alert">{error}</p>}
    {!restoring && !deploying && connected && <button onClick={onResume}>Reconnect to bot</button>}
    <button onClick={onDisconnect} disabled={!connected || restoring || !attached}>Disconnect Bot</button>
  </div>;
}
