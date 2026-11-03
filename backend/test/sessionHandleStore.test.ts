import assert from 'node:assert/strict';
import test from 'node:test';
import { createSessionHandle, SessionHandleStore } from '../../frontend/src/services/sessionHandleStore.js';

test('saved capability survives a new client store and is isolated by backend URL', () => {
  const values = new Map<string, string>();
  const storage = { getItem: (key: string) => values.get(key) ?? null, setItem: (key: string, value: string) => { values.set(key, value); }, removeItem: (key: string) => { values.delete(key); } };
  const store = new SessionHandleStore(() => storage, 'backend-a');
  const saved = createSessionHandle(); store.save(saved);
  assert.deepEqual(new SessionHandleStore(() => storage, 'backend-a').read(), saved);
  assert.equal(new SessionHandleStore(() => storage, 'backend-b').read(), null);
  const next = createSessionHandle(); store.save(next); store.clear(saved.sessionId);
  assert.deepEqual(store.read(), next);
  store.clear(next.sessionId); assert.equal(store.read(), null);
});

test('unavailable storage is tolerated on read but must prevent deployment before a handle is saved', () => {
  const store = new SessionHandleStore(() => { throw new Error('Storage disabled'); }, 'backend');
  assert.equal(store.read(), null);
  assert.throws(() => store.save(createSessionHandle()), /Storage disabled/);
  assert.doesNotThrow(() => store.clear('missing'));
});
