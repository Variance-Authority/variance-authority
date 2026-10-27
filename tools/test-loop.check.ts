import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { selectedLines } from '@variance-authority/sense/test-selection';
import { afterEach, describe, expect, it } from 'vitest';
import { inSlice } from './slices.mjs';
import { advice, discovered, idle } from './test-loop.mjs';

/**
 * `yarn test:loop` starts the unit runner only when the selection keeps a test
 * the runner would discover, so an edit that keeps no test costs the selection
 * and not a runner boot (ADR-0096).
 */

describe('discovered', () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('lists the unit tests tracked or new in the checkout, and none deleted or marked for another slice', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'test-loop-'));
    made.push(dir);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    await mkdir(join(dir, 'packages/a/src'), { recursive: true });
    for (const name of ['kept', 'gone', 'b.integration']) await writeFile(join(dir, `packages/a/src/${name}.test.ts`), '\n');
    git('add', '.');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'one');
    await rm(join(dir, 'packages/a/src/gone.test.ts'));
    await writeFile(join(dir, 'packages/a/src/new.test.ts'), '\n');
    expect(discovered(dir).sort()).toEqual(['packages/a/src/kept.test.ts', 'packages/a/src/new.test.ts']);
  });
});

describe('idle', () => {
  it('says what the selection read when it keeps no test, as the seam would, rather than that no test covers the change', async () => {
    // An edited module whose one test already ran over this text: the test covers the change and has nothing new to answer.
    const selection = {
      whole: new Set(['packages/a/src/story.test.tsx', 'packages/a/src/other.test.ts']),
      skip: new Set(['packages/a/src/story.test.tsx', 'packages/a/src/other.test.ts']),
      notes: ['read packages/a/src/story.ts: none (the record was taken over this text)'],
    };
    const files = ['packages/a/src/story.test.tsx', 'packages/a/src/other.test.ts'];
    const said = await idle(selection, files);

    // The seam's lines are the seam's to word; the loop adds only its verdict.
    expect(said).toBe([...selectedLines(selection, files), 'test:loop: types clean; no unit test runs at 0-1 (2 skipped)', ''].join('\n'));
    expect(said).not.toContain('covers the change');
  });
});

describe('inSlice', () => {
  it('holds a unit test in the unit slice and a marked one in its own', () => {
    expect(inSlice('unit', 'packages/cli/src/a.test.ts')).toBe(true);
    expect(inSlice('unit', 'packages/cli/src/a.integration.test.ts')).toBe(false);
    expect(inSlice('integration', 'packages/cli/src/a.integration.test.ts')).toBe(true);
    expect(inSlice('unit', 'tools/test-loop.mjs')).toBe(false);
  });
});

describe('advice', () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('names what kept the needs list from being read, in one line, instead of failing the loop', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'test-loop-'));
    made.push(dir);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    await writeFile(join(dir, 'a.ts'), 'export const a = 1;\n');
    git('add', '.');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'one');

    expect(await advice(dir)).toBe('needs: not read, no merge base with origin/main to measure the branch from\n');
  });
});
