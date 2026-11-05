import { useState } from 'react';
import type { BotSessionInfo } from '../types';
import type { ExcavationDirection, ExcavationRequest, ExcavationResult } from '../../../shared/excavationContracts.js';

export default function ExcavationPanel({ botInfo, request }: {
  botInfo: BotSessionInfo;
  request: (value: ExcavationRequest) => Promise<ExcavationResult>;
}) {
  const [origin, setOrigin] = useState({ x: '', y: '', z: '' });
  const [sizes, setSizes] = useState([{ direction: 'east', count: '1' }, { direction: 'south', count: '1' }, { direction: 'down', count: '1' }]);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const plan = botInfo.excavationPlan, task = botInfo.excavationStatus;
  const idle = botInfo.state === 'idle';
  const valid = Object.values(origin).every(s => /^-?\d+$/.test(s)) && sizes.every(s => /^[1-9]\d*$/.test(s.count));
  const send = async (value: ExcavationRequest) => {
    setPending(true);
    try { const result = await request(value); setMessage(result.ok ? result.message : result.error); }
    finally { setPending(false); }
  };
  return <fieldset disabled={pending} style={{ display: 'grid', gap: '.5rem', minWidth: 0 }}>
    <legend>⛏ Excavation</legend>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
      {(['x', 'y', 'z'] as const).map(axis => <label key={axis}>Origin {axis.toUpperCase()} <input aria-label={`Origin ${axis.toUpperCase()}`} type="number" step="1" value={origin[axis]} disabled={!idle}
        onChange={e => setOrigin({ ...origin, [axis]: e.target.value })} style={{ width: '5rem' }} /></label>)}
    </div>
    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '.5rem' }}>
      {[['east', 'west'], ['south', 'north'], ['down', 'up']].map((options, i) => <label key={i}>
        <select aria-label={`Axis ${i + 1} direction`} disabled={!idle} value={sizes[i].direction} onChange={e => setSizes(sizes.map((s, j) => j === i ? { ...s, direction: e.target.value } : s))}>
          {options.map(d => <option key={d}>{d}</option>)}
        </select> <input aria-label={`${sizes[i].direction} size`} type="number" min="1" max="128" step="1" value={sizes[i].count} disabled={!idle}
          onChange={e => setSizes(sizes.map((s, j) => j === i ? { ...s, count: e.target.value } : s))} style={{ width: '4rem' }} />
      </label>)}
    </div>
    <small>Sizes include the origin. Up to 10,000 positions; nearby jobs only. The bot stays on flat, stable terrain outside the region. No pit entry or access construction.</small>
    <button disabled={!idle || !valid} onClick={() => void send({ type: 'prepare', input: { origin: { x: Number(origin.x), y: Number(origin.y), z: Number(origin.z) }, sizes: sizes.map(s => ({ direction: s.direction as ExcavationDirection, count: Number(s.count) })) } })}>Preview excavation</button>
    {plan && <div>
      <p>Plan {plan.planId}: X {plan.bounds.x1}…{plan.bounds.x2}, Y {plan.bounds.y1}…{plan.bounds.y2}, Z {plan.bounds.z1}…{plan.bounds.z2} ({plan.dimension}).</p>
      <p>{plan.volume} positions: {plan.known.solid} solid, {plan.known.clear} clear, {plan.known.unknown} unknown. Expires {new Date(plan.expiresAt).toLocaleTimeString()}.</p>
      <p>Movement stays within 32 blocks of staging ({plan.staging.x}, {plan.staging.y}, {plan.staging.z}), at Y {plan.staging.y}. Prepare again if the bot moves.</p>
      <button disabled={!idle || Date.parse(plan.expiresAt) <= Date.now()} onClick={() => void send({ type: 'confirm', planId: plan.planId })}>Confirm excavation</button>{' '}
      <button onClick={() => void send({ type: 'cancel' })}>Discard plan</button>
    </div>}
    {task && <div role="status">Task {task.taskId}: {task.phase}, {task.checked}/{task.total} checked.
      {task.phase === 'cleanup-failed' && <p>Cleanup is unconfirmed. Disconnect this deployment before starting another task.</p>}
      {(task.phase === 'running' || task.phase === 'stopping') && <button onClick={() => void send({ type: 'stop', taskId: task.taskId })}>Stop excavation</button>}
    </div>}
    {message && <p role="status" style={{ overflowWrap: 'anywhere' }}>{message}</p>}
  </fieldset>;
}
