import { useState } from 'react';
import type { PlayerAccessSnapshot, PlayerRole } from '../types';
import './PlayerRolesPanel.css';

interface Props {
  snapshot: PlayerAccessSnapshot | null;
  pending: boolean;
  notice: string | null;
  connected: boolean;
  onUpdate: (username: string, role: PlayerRole | null) => void;
}

export default function PlayerRolesPanel({ snapshot, pending, notice, connected, onUpdate }: Props) {
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<PlayerRole>('crew');
  const disabled = !connected || !snapshot || pending;
  const currentOwner = snapshot?.assignments.find((assignment) => assignment.role === 'owner');
  return <section className="player-roles-panel" aria-label="Player role management">
    <h2>Player roles</h2>
    <p>Unassigned players are Visitors. Assign any Minecraft name, including offline players. Changes apply to new tasks; current tasks continue.</p>
    <form onSubmit={(event) => { event.preventDefault(); onUpdate(username, role); }}>
      <label>Minecraft player name
        <input aria-label="Role assignment player name" value={username} onChange={(event) => setUsername(event.target.value)}
          maxLength={16} pattern="[A-Za-z0-9_]{1,16}" placeholder="Steve123" required disabled={disabled} />
      </label>
      <label>Role
        <select aria-label="Player role" value={role} onChange={(event) => setRole(event.target.value as PlayerRole)} disabled={disabled}>
          {(snapshot?.roles ?? []).map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
      </label>
      <button type="submit" disabled={disabled || !username.trim()}>{pending ? 'Saving…' : 'Assign role'}</button>
    </form>
    {role === 'owner' && currentOwner && <p>Assigning Owner transfers that role from {currentOwner.username}. The previous Owner returns to Visitor.</p>}
    {notice && <p role="status" className="player-roles-notice">{notice}</p>}
    {!snapshot ? <p>{connected ? 'Loading roles…' : 'Reconnect to manage player roles.'}</p> : <>
      {snapshot.assignments.length === 0 ? <p>No explicit assignments. Everyone currently has Visitor access.</p> : <ul className="player-role-assignments">
        {snapshot.assignments.map((assignment) => <li key={assignment.username.toLowerCase()}>
          <strong>{assignment.username}</strong><span>{snapshot.roles.find((item) => item.id === assignment.role)?.label}</span>
          <button type="button" aria-label={`Remove role for ${assignment.username}`} disabled={disabled}
            onClick={() => onUpdate(assignment.username, null)}>Remove</button>
        </li>)}
      </ul>}
      <details><summary>What each role can do</summary><ul>
        {snapshot.roles.map((item) => <li key={item.id}><strong>{item.label}:</strong> {item.permissions.map((permission) => {
          const operation = permission.split('.')[1];
          return operation === 'stop' ? 'stop current task' : operation;
        }).join(', ')}</li>)}
      </ul></details>
    </>}
    <p>Assignments last until this bot is retired or the backend restarts. Names are case-insensitive. Removing a role restores Visitor access.</p>
  </section>;
}
