import { useEffect, useId, useState } from 'react';
import type { PlayerCommand, PlayerCommandResult, PlayerListSnapshot, ServerPlayer } from '../types';
import './PlayerListPanel.css';

interface PlayerListPanelProps {
  enabled: boolean;
  onEnabledChange: (enabled: boolean) => void;
  active: boolean;
  idle: boolean;
  visible: boolean;
  snapshot: PlayerListSnapshot | null;
  pending: boolean;
  notice: { error: boolean; text: string } | null;
  onCommand: (command: PlayerCommand) => Promise<PlayerCommandResult>;
  onStop: () => void;
}

function PlayerAvatar({ player }: { player: ServerPlayer }) {
  const [failed, setFailed] = useState(false);
  useEffect(() => setFailed(false), [player.skinUrl]);
  return (
    <span className="player-avatar" role="img" aria-label={`${player.username}'s player icon`}>
      <span title="Skin unavailable or loading">{player.username.slice(0, 1).toUpperCase()}</span>
      {player.skinUrl && !failed ? <>
        <img className="player-avatar-face" src={player.skinUrl} alt="" loading="lazy"
          referrerPolicy="no-referrer" onError={() => setFailed(true)} />
        <img className="player-avatar-hat" src={player.skinUrl} alt="" loading="lazy" referrerPolicy="no-referrer" />
      </> : null}
    </span>
  );
}

function PlayerHealth({ player }: { player: ServerPlayer }) {
  if (!player.health) return <span className="player-health player-health-unknown" role="img"
    aria-label={`${player.username}: health unavailable`} title="The server has not provided this player's health.">
    <HeartIcon /><span>?</span>
  </span>;
  const { value, maximum, source } = player.health;
  const scale = maximum ?? Math.max(20, value);
  const label = `${player.username}: ${value} HP${maximum !== null ? ` out of ${maximum}` : ', maximum unknown'}`;
  return (
    <span className="player-health" role="img" aria-label={label}
      title={`${label}. Server-reported (${source}); servers may hide or alter health. Each heart represents ${scale / 10} HP${maximum === null ? ' on a reference scale, not a known maximum' : ''}.`}>
      {Array.from({ length: 10 }, (_, index) => <span className="player-heart" key={index}>
        <HeartIcon />
        <span className="player-heart-fill" style={{ width: `${Math.max(0, Math.min(1, value / scale * 10 - index)) * 100}%` }}><HeartIcon /></span>
      </span>)}
      {maximum === null && <span className="player-health-reference">?</span>}
    </span>
  );
}

function HeartIcon() {
  return <svg viewBox="0 0 12 11" aria-hidden="true"><path d="M1 1h3v1h1v1h2V2h1V1h3v1h1v4h-1v1h-1v1H9v1H8v1H7v1H5v-1H4V9H3V8H2V7H1V6H0V2h1Z" /></svg>;
}

function FoodIcon() {
  return <svg viewBox="0 0 14 14" aria-hidden="true"><path d="m2 10 2-2-1-2 1-3 3-2 4 1 2 3-1 3-3 2-2-1-2 2v2H3v-1H1v-2Z" /></svg>;
}

function PlayerHunger({ player }: { player: ServerPlayer }) {
  if (!player.hunger) return player.isBot ? <span className="player-hunger player-hunger-unknown" role="img"
    aria-label={`${player.username}: hunger unavailable`} title="Waiting for the bot's hunger data."><FoodIcon />?</span> : null;
  const { value, maximum, saturation } = player.hunger;
  const label = `${player.username}: hunger ${value} out of ${maximum}; saturation ${saturation === null ? 'unavailable' : saturation}`;
  return <span className="player-hunger-group">
    <span className="player-hunger" role="img" aria-label={label} title={`${label}. Each food icon represents 2 hunger points.`}>
      {Array.from({ length: 10 }, (_, index) => <span className="player-food" key={index}>
        <FoodIcon /><span className="player-food-fill" style={{ width: `${Math.max(0, Math.min(1, value / 2 - index)) * 100}%` }}><FoodIcon /></span>
      </span>)}
    </span>
    <span className="player-saturation" title="Server-reported food saturation, a reserve used before hunger decreases.">Sat {saturation === null ? '?' : Math.round(saturation * 10) / 10}</span>
  </span>;
}

function ActionIcon({ name }: { name: 'whisper' | 'follow' | 'attack' | 'players' | 'chevron' }) {
  const paths = {
    whisper: <path d="M4 4h16v12H9l-5 4V4Zm4 5h8M8 12h5" />,
    follow: <><circle cx="9" cy="6" r="3" /><path d="M3 20v-3a6 6 0 0 1 10-4m2 3h6m-3-3 3 3-3 3" /></>,
    attack: <path d="m14 4 7-1-1 7-9 9-6-6 9-9ZM4 13l7 7M3 21l4-4" />,
    players: <><circle cx="9" cy="7" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3m1-17a3 3 0 0 1 0 6m3 11v-3a6 6 0 0 0-2-4" /></>,
    chevron: <path d="m6 9 6 6 6-6" />,
  };
  return <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">{paths[name]}</svg>;
}

const PAGE_SIZE = 25;

function PlayerDetails({ player }: { player: ServerPlayer }) {
  const location = player.position
    ? `${player.position.dimension} · X ${player.position.x}, Y ${player.position.y}, Z ${player.position.z}${player.distance !== null ? ` · ${player.distance} blocks` : ''}`
    : 'Location unknown (out of range or another dimension)';
  const details = `${location} · ${player.gameMode}${player.ping !== null ? ` · ${player.ping} ms` : ''}`;
  return <span className="player-location" title={`${details}${player.targetUnavailableReason ? `. ${player.targetUnavailableReason}` : ''}`}>{details}</span>;
}

export default function PlayerListPanel(props: PlayerListPanelProps) {
  const { enabled, onEnabledChange, active, idle, visible, snapshot, pending, notice, onCommand, onStop } = props;
  const [query, setQuery] = useState('');
  const [page, setPage] = useState(0);
  const [whisperTarget, setWhisperTarget] = useState<string | null>(null);
  const [message, setMessage] = useState('');
  const [attackTarget, setAttackTarget] = useState<string | null>(null);
  const listId = useId();
  const players = snapshot?.players ?? [];
  const filtered = players.filter((player) => player.username.toLowerCase().includes(query.toLowerCase()));
  const lastPage = Math.max(0, Math.ceil(filtered.length / PAGE_SIZE) - 1);
  const currentPage = Math.min(page, lastPage);
  const shown = filtered.slice(currentPage * PAGE_SIZE, (currentPage + 1) * PAGE_SIZE);

  return (
    <section className="player-list-panel" aria-label="Server players">
      <h2 className="player-list-header">
        <button type="button" className="player-list-toggle" disabled={!active && !enabled} aria-expanded={enabled}
          aria-controls={listId} onClick={() => {
            onEnabledChange(!enabled);
            setWhisperTarget(null);
            setAttackTarget(null);
            setMessage('');
          }}>
          <ActionIcon name="players" />
          <span>Server players</span>
          {enabled && snapshot ? <span className="player-count">{players.length}</span> : null}
          <span className="player-toggle-hint">{enabled ? 'Collapse' : active ? 'Click to load' : 'Connect a bot to view'}</span>
          <span className={`player-chevron${enabled ? ' player-chevron-open' : ''}`}><ActionIcon name="chevron" /></span>
        </button>
      </h2>
      {enabled && <div id={listId} className="player-list-dropdown">
        {!visible && <p className="player-list-help">Updates paused while this tab is hidden.</p>}
        {notice && <p className={`player-notice${notice.error ? ' player-notice-error' : ''}`} role={notice.error ? 'alert' : 'status'}>{notice.text}</p>}
        <div className="player-list-toolbar">
          <input aria-label="Search players" type="search" placeholder="Search player name…" value={query}
            onChange={(event) => { setQuery(event.target.value); setPage(0); }} />
          {!idle && active && <button type="button" className="player-button" onClick={onStop}>Stop current task</button>}
        </div>
        {!snapshot ? <p className="player-list-help" role="status">{active ? 'Waiting for player list…' : 'Bot is not active.'}</p>
          : shown.length === 0 ? <p className="player-list-help">{players.length ? 'No matching players.' : 'The server has not provided any players.'}</p>
            : <ul className="player-list">
              {shown.map((player) => (
                <li className="player-list-item" key={player.uuid || player.username}>
                  <div className="player-row">
                  <div className="player-identity">
                    <PlayerAvatar player={player} />
                    <div className="player-name-block">
                      <div className="player-name-line">
                        <strong title={player.displayName}>{player.username}</strong>
                        {player.isBot && <span className="player-badge">Bot</span>}
                        <PlayerHealth player={player} />
                        <PlayerHunger player={player} />
                      </div>
                      <PlayerDetails player={player} />
                    </div>
                  </div>
                  <div className="player-actions">
                    <button type="button" className="player-button player-icon-button" disabled={!active || player.isBot || pending}
                      title={`Whisper to ${player.username}`} aria-label={`Whisper to ${player.username}`}
                      onClick={() => { setWhisperTarget(player.username); setMessage(''); setAttackTarget(null); }}><ActionIcon name="whisper" /></button>
                    <button type="button" className="player-button player-icon-button" disabled={!active || !idle || !player.canTarget || pending}
                      title={`Follow ${player.username}: ${player.targetUnavailableReason ?? (!idle ? 'Stop the current task first.' : 'Follow within 3 blocks.')}`}
                      aria-label={`Follow ${player.username}`} onClick={() => { void onCommand({ type: 'follow', target: player.username }); }}><ActionIcon name="follow" /></button>
                    <button type="button" className="player-button player-icon-button player-button-danger" disabled={!active || !idle || !player.canTarget || player.gameMode === 'creative' || pending}
                      title={`Attack ${player.username}: ${player.targetUnavailableReason ?? (player.gameMode === 'creative' ? 'Creative-mode players are invulnerable.' : !idle ? 'Stop the current task first.' : 'Attack until stopped, defeated, or out of range.')}`}
                      aria-label={`Attack ${player.username}`} onClick={() => { setAttackTarget(player.username); setWhisperTarget(null); }}><ActionIcon name="attack" /></button>
                  </div>
                  </div>
                  {whisperTarget === player.username && <form className="player-whisper" aria-label={`Whisper to ${player.username}`}
                    onSubmit={async (event) => {
                      event.preventDefault();
                      if (!message.trim() || pending) return;
                      const result = await onCommand({ type: 'whisper', target: player.username, message });
                      if (result.ok) setMessage('');
                    }}>
                    <label>Private message to {player.username}
                      <input value={message} maxLength={200} required aria-label={`Private message to ${player.username}`}
                        onChange={(event) => setMessage(event.target.value)} disabled={!active || pending} autoFocus />
                    </label>
                    <button type="submit" className="player-button" disabled={!active || pending || !message.trim()}>Send whisper</button>
                    <button type="button" className="player-button" onClick={() => setWhisperTarget(null)}>Cancel</button>
                  </form>}
                  {attackTarget === player.username && <div className="player-confirm">
                    <span>Attack {player.username}?</span>
                    <button type="button" className="player-button player-button-danger" disabled={!active || !idle || !player.canTarget || player.gameMode === 'creative' || pending}
                      onClick={() => { setAttackTarget(null); void onCommand({ type: 'attack', target: player.username }); }}>Confirm attack</button>
                    <button type="button" className="player-button" onClick={() => setAttackTarget(null)}>Cancel</button>
                  </div>}
                </li>
              ))}
            </ul>}
        {filtered.length > PAGE_SIZE && <nav className="player-pagination" aria-label="Player list pages">
          <button type="button" className="player-button" disabled={currentPage === 0} onClick={() => setPage(currentPage - 1)}>Previous</button>
          <span>Page {currentPage + 1} of {lastPage + 1}</span>
          <button type="button" className="player-button" disabled={currentPage === lastPage} onClick={() => setPage(currentPage + 1)}>Next</button>
        </nav>}
        <p className="player-list-help">Checks for changes every 3 seconds while open. Health and locations depend on what the server exposes; hover hearts for HP. Hunger and saturation are available for the bot only; hover food icons for values. Updates pause when collapsed or this tab is hidden.</p>
      </div>}
    </section>
  );
}
