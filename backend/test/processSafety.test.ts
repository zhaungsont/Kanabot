import assert from 'node:assert/strict';
import test from 'node:test';
import { spawnSync } from 'node:child_process';

for (const failure of ['exception', 'network exception', 'packet exception', 'rejection'] as const) {
  test(`fatal ${failure} terminates instead of continuing with uncertain state`, () => {
    const moduleUrl = new URL('../src/runtime/processSafety.ts', import.meta.url).href;
    const error = failure === 'network exception' ? "Object.assign(new Error('network'), { code: 'ECONNRESET' })"
      : failure === 'packet exception' ? "Object.assign(new Error('Unexpected buffer end'), { name: 'PartialReadError' })" : "new Error('fatal test failure')";
    const trigger = failure === 'rejection' ? `Promise.reject(${error});` : `setTimeout(() => { throw ${error}; }, 0);`;
    const result = spawnSync(process.execPath, ['--import', 'tsx', '--input-type=module', '-e',
      `await import(${JSON.stringify(moduleUrl)}); ${trigger} setTimeout(() => console.log('continued after fatal error'), 100);`], {
      cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10_000,
    });
    assert.equal(result.error, undefined);
    assert.equal(result.status, 1);
    assert.match(result.stderr, /Fatal uncaught error/);
    assert.doesNotMatch(result.stdout, /continued after fatal error/);
  });
}
