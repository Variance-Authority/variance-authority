import { execFileSync } from 'node:child_process';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { footprintOf, snapshotOf } from './test-loop.mjs';

/**
 * `yarn test:loop` answers for the edits since its last invocation (spec 0103).
 *
 * What counts as an edit when a marker from the last green invocation exists.
 */

const made: string[] = [];

afterEach(async () => {
  for (const dir of made.splice(0)) await rm(dir, { recursive: true, force: true });
});

function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' });
}

async function repository(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'test-loop-'));
  made.push(dir);
  git(dir, 'init', '-q', '-b', 'main');
  git(dir, 'config', 'user.email', 'a@b.c');
  git(dir, 'config', 'user.name', 'a');
  await writeFile(join(dir, 'a.ts'), 'one\ntwo\nthree\n');
  await writeFile(join(dir, 'b.ts'), 'x\n');
  git(dir, 'add', '.');
  git(dir, 'commit', '-q', '-m', 'init');
  return dir;
}

describe('footprintOf', () => {
  it('is the whole dirty tree when no invocation came before', async () => {
    const dir = await repository();
    await writeFile(join(dir, 'a.ts'), 'one\nTWO\nthree\n');
    await writeFile(join(dir, 'new.ts'), 'n\n');
    expect([...footprintOf(dir, undefined)].sort()).toEqual(['a.ts', 'new.ts']);
  });

  it('is only what moved since the marker', async () => {
    const dir = await repository();
    await writeFile(join(dir, 'a.ts'), 'one\nTWO\nthree\n');
    const marker = snapshotOf(dir);
    await writeFile(join(dir, 'b.ts'), 'x\ny\n');
    expect([...footprintOf(dir, marker)]).toEqual(['b.ts']);
  });

  it('forgets the marker once a commit moved HEAD', async () => {
    const dir = await repository();
    await writeFile(join(dir, 'a.ts'), 'one\nTWO\nthree\n');
    const marker = snapshotOf(dir);
    git(dir, 'commit', '-q', '-am', 'second');
    await writeFile(join(dir, 'b.ts'), 'x\ny\n');
    expect([...footprintOf(dir, marker)]).toEqual(['b.ts']);
  });

  it('is empty when nothing moved since the marker', async () => {
    const dir = await repository();
    await writeFile(join(dir, 'a.ts'), 'one\nTWO\nthree\n');
    expect(footprintOf(dir, snapshotOf(dir)).size).toBe(0);
  });

  it('does not touch the index', async () => {
    const dir = await repository();
    await writeFile(join(dir, 'new.ts'), 'n\n');
    footprintOf(dir, undefined);
    expect(git(dir, 'diff', '--cached', '--name-only')).toBe('');
  });
});
