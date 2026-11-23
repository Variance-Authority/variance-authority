import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, realpathSync, rmSync, writeFileSync, mkdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { test } from 'vitest';
import { executeProgram } from './execute.mjs';
import { openQuestions } from './questions.mjs';

test('canonical intersection membership drives an empty fallback and preserves incomplete evidence', async () => {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'runbook-intersection-')));
  try {
    mkdirSync(join(root, 'src'));
    writeFileSync(join(root, 'package.json'), '{"name":"intersection-fixture","private":true}');
    writeFileSync(join(root, 'src/a.ts'), 'export const Alpha = 1;');
    writeFileSync(join(root, 'src/b.ts'), 'export const Beta = 2;');
    writeFileSync(join(root, 'src/widget.ts'), 'export interface Widget { completed: boolean; }');
    writeFileSync(join(root, 'src/widget.rs'), 'pub struct Widget { pub completed: bool }');
    execFileSync('git', ['init', '--quiet', root]);
    execFileSync(process.execPath, [resolve('packages/cli/dist/bin.js'), 'index', '--wait'], { cwd: root, stdio: 'pipe' });
    const context = await openQuestions(root);
    const run = (questions: unknown[]) => executeProgram({
      version: 1, budgets: { calls: 2, milliseconds: 20000, answerBytes: 12000 },
      steps: [
        { id: 'common', question: 'intersection', input: { questions } },
        { id: 'fallback', question: 'discover', input: { path: '^src/' }, when: { step: 'common', is: 'empty' } },
      ],
    }, { ...context, request: {} });
    const first = { question: 'discover', input: { path: '^src/a\\.ts$' } };
    const disjoint = await run([first, { question: 'discover', input: { path: '^src/b\\.ts$' } }]);
    assert.equal(disjoint.halt, 'program-ended');
    assert.deepEqual(disjoint.trace.map(row => row.state), ['empty', 'nonempty']);
    assert.equal(disjoint.evidence[0].observation.membershipStatus, 'complete');
    assert.deepEqual(disjoint.evidence[0].observation.files, []);
    assert.match(disjoint.answers[0].answer, /No file is in all of them/u);
    assert.equal(disjoint.completion, 'unproved');

    const common = await run([first, { question: 'discover', input: { path: '^src/' } }]);
    assert.deepEqual(common.trace.map(row => row.state), ['nonempty', 'condition-skipped']);
    assert.deepEqual(common.evidence[0].observation.files, [{ file: 'src/a.ts', lines: [] }]);

    const missing = await run([first, { question: 'symbol', input: { name: 'Gone' } }]);
    assert.deepEqual(missing.trace.map(row => row.state), ['unknown', 'condition-skipped']);
    assert.equal(missing.evidence[0].observation.membershipError.name, 'FoundNothing');

    for (const question of ['symbol', 'uses']) {
      const member = await run([
        { question, input: { name: 'Widget.completed' } },
        { question: 'discover', input: { path: '\\.rs$' } },
      ]);
      assert.deepEqual(member.trace.map(row => row.state), ['incomplete', 'condition-skipped']);
      assert.deepEqual(member.evidence[0].observation.files, []);
      assert.match(member.evidence[0].observation.unread.join('\n'), /Rust files were not read/u);
      assert.match(member.answers[0].answer, /Rust files were not read/u);
    }

    // The published tree still names this file, while a live text predicate cannot read it.
    rmSync(join(root, 'src/a.ts'));
    const incomplete = await run([first, { question: 'discover', input: { path: '^src/a\\.ts$', text: 'Alpha' } }]);
    assert.deepEqual(incomplete.trace.map(row => row.state), ['incomplete', 'condition-skipped']);
    assert.equal(incomplete.evidence[0].observation.membershipStatus, 'incomplete');
    assert.match(incomplete.evidence[0].observation.unread.join('\n'), /2: ripgrep:/u);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
