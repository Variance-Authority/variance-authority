import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { inSlice } from './slices.mjs';
import { addedSince, starts } from './test-loop.mjs';

/**
 * `yarn test:loop` starts a runner only for a slice whose selection keeps a
 * test, so an edit no test entered costs the selection and not three runner
 * boots (ADR-0096).
 */

const reading = (skip: string[], whole: string[], extra: Record<string, unknown> = {}) => ({
  skip: new Set(skip),
  whole: new Set(whole),
  ...extra,
});

describe('starts', () => {
  it('starts nothing when the selection skips every test the record knows and nothing is new', () => {
    expect(starts(reading(['a.test.ts', 'b.test.ts'], ['a.test.ts']), [])).toBe(false);
  });

  it('starts the runner when a recorded test is kept', () => {
    expect(starts(reading(['b.test.ts'], ['a.test.ts', 'b.test.ts']), [])).toBe(true);
  });

  it('starts the runner when the reading declined, which runs the slice whole', () => {
    expect(starts(reading([], ['a.test.ts'], { declined: 'no record' }), [])).toBe(true);
  });

  it('starts the runner when a file is new since the record, which may be a test it never saw', () => {
    expect(starts(reading(['a.test.ts'], ['a.test.ts']), ['c.test.ts'])).toBe(true);
  });
});

describe('addedSince', () => {
  const made: string[] = [];
  afterEach(async () => {
    for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
  });

  it('names the paths the commit does not hold', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'test-loop-'));
    made.push(dir);
    const git = (...args: string[]) => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    git('init', '-q', '-b', 'main');
    await writeFile(join(dir, 'old.md'), 'one\n');
    git('add', 'old.md');
    git('-c', 'user.email=a@b.c', '-c', 'user.name=a', 'commit', '-qm', 'one');
    const commit = git('rev-parse', 'HEAD').trim();
    await writeFile(join(dir, 'new.test.ts'), 'two\n');
    expect(addedSince(dir, commit, ['old.md', 'new.test.ts'])).toEqual(['new.test.ts']);
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
