import assert from 'node:assert/strict';
import test from 'node:test';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { tsImport } from 'tsx/esm/api';
import type { BotState } from '../src/types.js';

// Reuse the frontend's installed React runtime; no additional test dependency.
const requireFrontend = createRequire(new URL('../../frontend/package.json', import.meta.url));
const { createElement } = requireFrontend('react');
const { renderToStaticMarkup } = requireFrontend('react-dom/server');
const frontendImport = { parentURL: import.meta.url, tsconfig: fileURLToPath(new URL('../../frontend/tsconfig.json', import.meta.url)) };
const { default: SessionControls } = await tsImport('../../frontend/src/components/SessionControls.tsx', frontendImport);
const { default: ActionPanel } = await tsImport('../../frontend/src/components/ActionPanel.tsx', frontendImport);

for (const state of ['spawning', 'dead', 'disconnected', 'idle', 'task'] as BotState[]) {
  test(`an attached dashboard can retire a ${state} bot`, () => {
    const controls = renderToStaticMarkup(createElement(SessionControls, {
      connected: true, restoring: false, deploying: state === 'spawning', attached: true,
      error: null, onResume() {}, onDisconnect() {},
    }));
    const panel = renderToStaticMarkup(createElement(ActionPanel, {
      botInfo: { sessionId: 'session', config: { serverHost: 'example.test', botName: 'mc_bot' }, state, currentTask: null, taskTarget: null, spawnedAt: null, uptime: 0 },
      onAction() {}, onExcavate() {},
    }));
    assert.match(controls, /<button>Disconnect Bot<\/button>/);
    assert.doesNotMatch(panel, /Disconnect Bot/);
  });
}

test('retirement waits for an authorized attachment and a connected viewer', () => {
  for (const overrides of [{ connected: false }, { restoring: true }, { attached: false }]) {
    const html = renderToStaticMarkup(createElement(SessionControls, {
      connected: true, restoring: false, deploying: false, attached: true, error: null,
      onResume() {}, onDisconnect() {}, ...overrides,
    }));
    assert.match(html, /<button disabled="">Disconnect Bot<\/button>/);
  }
});

test('dashboard excavation presents origin and sizes with an explicit preview step', () => {
  const html = renderToStaticMarkup(createElement(ActionPanel, {
    botInfo: { sessionId: 'session', config: { serverHost: 'example.test', botName: 'mc_bot' }, state: 'idle', currentTask: null, taskTarget: null, spawnedAt: null, uptime: 0 },
    onAction() {}, onExcavate() {},
  }));
  assert.match(html, /Origin X/); assert.match(html, /east size/); assert.match(html, /Preview excavation/);
  assert.doesNotMatch(html, /Start Excavation/); assert.match(html, /Sizes include the origin/);
});
