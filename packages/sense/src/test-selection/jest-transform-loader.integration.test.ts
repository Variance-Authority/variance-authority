import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const execute = promisify(execFile);

// Each host gets a fresh module cache: a native ESM load before a require hook
// would hide the CommonJS namespace that made Jest reject Jira's transformer.
const load = String.raw`
const assert = require('node:assert/strict');
const fs = require('node:fs');
const Module = require('node:module');
const path = require('node:path');
const target = require.resolve('@variance-authority/sense/jest-transform');
if (process.argv[1] === 'transpiled') {
  const { transformSync } = require('esbuild');
  const original = Module._extensions['.js'];
  Module._extensions['.js'] = (module, file) => {
    if (file !== target) return original(module, file);
    const { code } = transformSync(fs.readFileSync(file, 'utf8'), { format: 'cjs', platform: 'node' });
    module._compile(code, file);
  };
}
(async () => {
  const raw = require(target);
  if (process.argv[1] === 'transpiled') assert.equal(raw.__esModule, true);
  const loaded = await require('jest-util').requireOrImportModule(target);
  assert.equal(typeof loaded?.createTransformer, 'function', 'Jest must load the factory');
  assert.equal(loaded.createTransformer, raw.createTransformer);
  const transformer = await loaded.createTransformer({ root: process.cwd(), cadence: false });
  assert.equal(typeof transformer.process, 'function');
  const { code } = transformer.process('export function greet() { return "hello"; }',
    path.join(process.cwd(), 'src/greet.js'), {
      config: { cacheDirectory: path.join(process.cwd(), 'node_modules/.cache/jest') },
      configString: '{}', instrument: false,
    });
  assert.ok(code.includes('__va'), 'the loaded factory must still place probes');
  console.log('loaded and instrumented');
})().catch((error) => { console.error(error); process.exitCode = 1; });
`;

describe('Jest loading the published transformer', () => {
  it.each(['native', 'transpiled'])('loads and runs the factory under a %s host', async (host) => {
    const { stdout } = await execute(process.execPath, ['-e', load, host]);
    expect(stdout.trim()).toBe('loaded and instrumented');
  });
});
