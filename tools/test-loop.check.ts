import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inSlice } from './slices.mjs';
import { discovered, idle } from './test-loop.mjs';

/**
 * `yarn test:loop` starts the unit runner only when the selection keeps a test
 * the runner would discover, so an edit no test covers costs the selection and
 * not a runner boot (ADR-0096).
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
    const said = await idle(selection, ['packages/a/src/story.test.tsx', 'packages/a/src/other.test.ts']);

    expect(said).toBe(
      [
        'variance-authority: selected none of 2',
        '  read packages/a/src/story.ts: none (the record was taken over this text)',
        'test:loop: types clean; no unit test runs at 0-1 (2 skipped)',
        '',
      ].join('\n'),
    );
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
