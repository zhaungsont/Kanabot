import { useState } from 'react';
import type { UpkeepSettings, UpkeepStatus } from '../../../shared/upkeepContracts.js';
import type { SessionResult } from '../types';
import './BehaviorPanel.css';

export default function UpkeepPanel({ status, connected, onUpdate }: {
  status: UpkeepStatus; connected: boolean;
  onUpdate: (settings: UpkeepSettings) => Promise<SessionResult<UpkeepSettings>>;
}) {
  const [pending, setPending] = useState(false), [notice, setNotice] = useState('');
  const save = async (settings: UpkeepSettings) => {
    setPending(true); setNotice('');
    try { const result = await onUpdate(settings); setNotice(result.ok ? 'Upkeep settings saved.' : result.error); }
    catch { setNotice('Settings were not acknowledged. Reconnect to check.'); }
    finally { setPending(false); }
  };
  return <section className="behavior-panel" aria-label="Bot upkeep">
    <h2>Bot Upkeep</h2>
    <p>Food and armor maintenance during or outside tasks. Settings stay with this bot without a dashboard.</p>
    <label className="behavior-toggle"><input type="checkbox" checked={status.settings.autoEat} disabled={!connected || pending}
      onChange={e => void save({ ...status.settings, autoEat: e.target.checked })} />Auto-eat</label>
    <p>Yield at a safe point, eat, then verify the task’s current tool before resuming.</p>
    <label className="behavior-toggle"><input type="checkbox" checked={status.settings.autoArmor} disabled={!connected || pending}
      onChange={e => void save({ ...status.settings, autoArmor: e.target.checked })} />Auto-armor</label>
    <p>Equip available armor without resetting movement. Manual slot removals stay protected until you turn Auto-armor off and on.</p>
    <p role="status"><strong>{status.activity}:</strong> {status.detail}</p>
    {notice && <p role="status">{notice}</p>}
  </section>;
}
