import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { test } from 'vitest';
import { executeProgram } from './execute.mjs';
import { openQuestions } from './questions.mjs';

test('observed scalar declaration files keep namesake importer answers separate', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'runbook-scalar-')));
  try {
    for (const [file, source] of Object.entries({
      'package.json': '{"name":"scalar-binding-fixture","private":true}',
      'src/a.ts': 'export function Item() { return 1; }',
      'src/b.ts': 'export function Item() { return 2; }',
      'src/use-a.ts': "import { Item } from './a'; export const a = Item();",
      'src/use-b.ts': "import { Item } from './b'; export const b = Item();",
    })) {
      mkdirSync(dirname(join(root, file)), { recursive: true });
      writeFileSync(join(root, file), source);
    }
    execFileSync('git', ['init', '--quiet', root]);
    execFileSync(process.execPath, [resolve('packages/cli/dist/bin.js'), 'index', '--wait'], { cwd: root, stdio: 'pipe' });
    const context = await openQuestions(root);
    const program = { version: 1,
      budgets: { calls: 3, milliseconds: 30000, answerBytes: 20000 },
      steps: [
        { id: 'declarations', question: 'symbol', input: { name: 'Item' } },
        { id: 'importers', question: 'uses', input: { name: 'Item' },
          fromFiles: { step: 'declarations', input: 'file', as: 'string' } },
        { id: 'same', question: 'uses', input: { name: 'Item' },
          fromFiles: { step: 'declarations', input: 'file', as: 'string' } },
      ],
    };
    const result = await executeProgram(program, { ...context, request: {} });
    assert.equal(result.halt, 'program-ended');
    assert.equal(result.calls, 3);
    const importers = result.evidence.filter(row => row.step === 'importers');
    assert.deepEqual(importers.map(row => [row.binding.file, row.input.file,
      row.observation.files.map(site => site.file)]), [
      ['src/a.ts', 'src/a.ts', ['src/use-a.ts']],
      ['src/b.ts', 'src/b.ts', ['src/use-b.ts']],
    ]);
    assert.ok(importers.every(row => row.binding.membershipStatus === 'complete'));
    assert.deepEqual(result.trace.filter(row => row.step === 'same').map(row => row.state),
      ['repeated-call', 'repeated-call']);
    for (const as of ['array', 1, null]) {
      const invalid = { ...program, steps: [program.steps[0], {
        id: 'invalid', question: 'uses', input: { name: 'Item' },
        fromFiles: { step: 'declarations', input: 'file', as },
      }] };
      await assert.rejects(() => executeProgram(invalid, { ...context, request: {} }), /invalid program/u);
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
