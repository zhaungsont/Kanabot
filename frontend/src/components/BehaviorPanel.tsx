import { useEffect, useState } from 'react';
import type { BehaviorSettings, BehaviorStatus } from '../../../shared/behaviorContracts.js';
import type { SessionResult } from '../types';
import './BehaviorPanel.css';

interface Props {
  status: BehaviorStatus;
  connected: boolean;
  onUpdate: (settings: BehaviorSettings) => Promise<SessionResult<BehaviorSettings>>;
}
export default function BehaviorPanel({ status, connected, onUpdate }: Props) {
  const { settings } = status;
  const [duration, setDuration] = useState(String(settings.selfDefense.durationSeconds));
  const [mode, setMode] = useState(settings.selfDefense.mode);
  const [pending, setPending] = useState(false);
  const [notice, setNotice] = useState('');
  useEffect(() => { setDuration(String(settings.selfDefense.durationSeconds)); setMode(settings.selfDefense.mode); },
    [settings.selfDefense.durationSeconds, settings.selfDefense.mode]);
  const save = async (next: BehaviorSettings) => {
    setPending(true); setNotice('');
    try { const result = await onUpdate(next); setNotice(result.ok ? 'Settings saved.' : result.error); }
    catch { setNotice('Could not save settings. Reconnect to check.'); }
    finally { setPending(false); }
  };
  const disabled = !connected || pending;
  return <section className="behavior-panel" aria-label="Idle behaviors">
    <h2>Idle Behaviors</h2>
    <p>Only run when no gameplay task is active. A task yielding to Upkeep stays active.</p>
    <label className="behavior-toggle"><input type="checkbox" checked={settings.selfDefense.enabled} disabled={disabled}
      onChange={event => void save({ ...settings, selfDefense: { ...settings.selfDefense, enabled: event.target.checked } })} />Self-defense</label>
    <form onSubmit={event => {
      event.preventDefault();
      void save({ ...settings, selfDefense: { ...settings.selfDefense, mode, durationSeconds: Number(duration) } });
    }}>
      <label>Reaction<select value={mode} disabled={disabled} onChange={event => setMode(event.target.value as 'fight' | 'flight')}>
        <option value="flight">Flight — flee</option><option value="fight">Fight — retaliate</option>
      </select></label>
      <label>Response duration (seconds)<input type="number" min="1" max="120" step="1" required value={duration}
        disabled={disabled} onChange={event => setDuration(event.target.value)} /></label>
      <button disabled={disabled || !Number.isInteger(Number(duration)) || Number(duration) < 1 || Number(duration) > 120}>Apply response settings</button>
    </form>
    <p>Reacts to an identified attacker, including players. Fight needs a held sword/axe; otherwise the bot flees. Repeated hits do not extend the response.</p>
    <label className="behavior-toggle"><input type="checkbox" checked={settings.avoidDrowning ?? false} disabled={disabled}
      onChange={event => void save({ ...settings, avoidDrowning: event.target.checked })} />Avoid drowning</label>
    <p>When idle and oxygen is low, try a bounded route to nearby air above. Cannot rescue the bot during a task.</p>
    <label className="behavior-toggle"><input type="checkbox" disabled />Sleep — TODO</label>
    <p role="status"><strong>{status.activity === 'idle' ? 'Waiting' : status.activity}:</strong> {status.detail}</p>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
