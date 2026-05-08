import { useState, useEffect, useRef, FormEvent, KeyboardEvent } from 'react';
import { ChatMessage } from '../types';

interface ChatBoxProps {
  messages: ChatMessage[];
  onSend: (message: string) => void;
  disabled?: boolean;
}

function formatTime(ts: number): string {
  return new Date(ts).toLocaleTimeString('en-US', {
    hour12: false,
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

export default function ChatBox({ messages, onSend, disabled = false }: ChatBoxProps) {
  const [input, setInput] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = (e: FormEvent) => {
    e.preventDefault();
    const msg = input.trim();
    if (!msg || disabled) return;
    onSend(msg);
    setInput('');
  };

  const handleKeyDown = (e: KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      const msg = input.trim();
      if (!msg || disabled) return;
      onSend(msg);
      setInput('');
    }
  };

  return (
    <div style={styles.container}>
      <div style={styles.header}>
        <span style={styles.headerIcon}>💬</span>
        <span style={styles.headerTitle}>In-Game Chat</span>
      </div>

      <div style={styles.messages}>
        {messages.length === 0 && (
          <span style={styles.empty}>No messages yet...</span>
        )}
        {messages.map((msg, i) => {
          const isSystem = msg.username === 'System';
          const isBot = msg.isBot && !isSystem;

          return (
            <div key={i} style={styles.msgRow}>
              <span style={styles.msgTime}>{formatTime(msg.timestamp)}</span>
              <span
                style={{
                  ...styles.msgUsername,
                  color: isSystem
                    ? 'var(--color-system-msg)'
                    : isBot
                    ? 'var(--color-bot-msg)'
                    : 'var(--color-success)',
                }}
              >
                {msg.username}
              </span>
              <span style={styles.msgSep}>›</span>
              <span
                style={{
                  ...styles.msgText,
                  color: isSystem ? 'var(--color-system-msg)' : 'var(--color-terminal-text)',
                  fontStyle: isSystem ? 'italic' : 'normal',
                }}
              >
                {msg.message}
              </span>
            </div>
          );
        })}
        <div ref={bottomRef} />
      </div>

      <form onSubmit={handleSend} style={styles.inputRow}>
        <input
          style={styles.input}
          type="text"
          placeholder={disabled ? 'Bot not active...' : 'Type a message...'}
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={disabled}
          maxLength={256}
        />
        <button style={styles.sendBtn} type="submit" disabled={disabled || !input.trim()}>
          Send
        </button>
      </form>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    background: '#20203A',
    borderRadius: 'var(--radius-md)',
    display: 'flex',
    flexDirection: 'column',
    overflow: 'hidden',
    height: '100%',
    minHeight: '220px',
    boxShadow: 'var(--shadow-md)',
  },
  header: {
    display: 'flex',
    alignItems: 'center',
    gap: '0.5rem',
    padding: '0.6rem 1rem',
    borderBottom: '1px solid rgba(255,255,255,0.07)',
    background: 'rgba(0,0,0,0.2)',
    flexShrink: 0,
  },
  headerIcon: {
    fontSize: '0.9rem',
  },
  headerTitle: {
    color: 'rgba(255,255,255,0.5)',
    fontSize: '0.75rem',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.05em',
  },
  messages: {
    flex: 1,
    overflowY: 'auto' as const,
    padding: '0.75rem 1rem',
    display: 'flex',
    flexDirection: 'column',
    gap: '4px',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.78rem',
  },
  empty: {
    color: 'rgba(255,255,255,0.2)',
    fontStyle: 'italic',
  },
  msgRow: {
    display: 'flex',
    gap: '0.4rem',
    alignItems: 'baseline',
    flexWrap: 'wrap' as const,
  },
  msgTime: {
    color: 'rgba(255,255,255,0.25)',
    fontSize: '0.7rem',
    flexShrink: 0,
  },
  msgUsername: {
    fontWeight: 700,
    flexShrink: 0,
  },
  msgSep: {
    color: 'rgba(255,255,255,0.3)',
    flexShrink: 0,
  },
  msgText: {
    wordBreak: 'break-word' as const,
    flex: 1,
  },
  inputRow: {
    display: 'flex',
    borderTop: '1px solid rgba(255,255,255,0.08)',
    flexShrink: 0,
  },
  input: {
    flex: 1,
    background: 'rgba(0,0,0,0.3)',
    border: 'none',
    color: '#fff',
    padding: '0.65rem 1rem',
    fontFamily: 'var(--font-mono)',
    fontSize: '0.85rem',
    outline: 'none',
    borderRadius: '0 0 0 var(--radius-md)',
  },
  sendBtn: {
    background: 'var(--color-accent)',
    border: 'none',
    color: 'var(--color-text)',
    padding: '0.65rem 1.25rem',
    fontWeight: 700,
    fontSize: '0.85rem',
    cursor: 'pointer',
    borderRadius: '0 0 var(--radius-md) 0',
    transition: 'background 0.15s',
  },
};
