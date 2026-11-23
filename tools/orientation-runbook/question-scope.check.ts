import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'vitest';
import { native } from '../../packages/sense/dist/addon.js';
import type { NativeHelp } from '../../packages/sense/dist/help-reading.js';
import { openQuestions } from './questions.mjs';

test('one paired factual question shares its native index and closes it before the next', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'runbook-question-')));
  const scanner = native()! as NativeHelp & { openIndex: NonNullable<NativeHelp['openIndex']> };
  const original = scanner.openIndex;
  const events: string[] = [];
  try {
    for (const [file, source] of Object.entries({
      'package.json': '{"name":"question-scope-fixture","private":true}',
      'src/Panel.ts': 'export function Panel() { return 1; }',
      'src/example.ts': "import { Panel } from './Panel'; export const example = () => Panel();",
    })) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    execFileSync('git', ['init', '--quiet', root]);
    execFileSync(process.execPath, [resolve('packages/cli/dist/bin.js'), 'index', '--wait'], { cwd: root, stdio: 'pipe' });
    const context = await openQuestions(root);
    scanner.openIndex = function (...args) {
      const handle = original.apply(this, args);
      events.push('open');
      const close = handle.close;
      handle.close = function () {
        events.push('close');
        return close.call(this);
      };
      return handle;
    };
    const declaration = await context.drive('discover', { declares: '^Panel$' });
    assert.equal(declaration.status, 'answered');
    assert.deepEqual(declaration.files.map(row => row.file), ['src/Panel.ts']);
    assert.match(declaration.answer, /declares Panel/u);
    assert.deepEqual(declaration.apiCalls.map(row => [row.api, row.status]), [
      ['Tool.files', 'ok'], ['Tool.run', 'ok'],
    ]);
    assert.deepEqual(events, ['open', 'close'], 'one factual question must open its index only once');

    events.length = 0;
    const refusal = await context.drive('discover', { declares: '[' });
    assert.equal(refusal.status, 'error');
    assert.equal(refusal.membershipStatus, 'unknown');
    assert.equal(refusal.error.message, refusal.membershipError.message);
    assert.deepEqual(refusal.apiCalls.map(row => [row.api, row.status]), [
      ['Tool.files', 'error'], ['Tool.run', 'error'],
    ]);
    assert.deepEqual(events, ['open', 'close'], 'a reader refusal must still close the shared index');

    events.length = 0;
    const consumer = await context.drive('discover', { to: ['src/Panel.ts#Panel'], path: 'example' });
    assert.equal(consumer.status, 'answered');
    assert.deepEqual(consumer.files.map(row => row.file), ['src/example.ts']);
    assert.deepEqual(events, ['open', 'close'], 'a later question must open a fresh scope');
  } finally {
    scanner.openIndex = original;
    rmSync(root, { recursive: true, force: true });
  }
});
