import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, realpath, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { checkoutPath, existedAt, existingAt } from './checkout-path.js';

/** What a commit held, asked of a real repository: of one path, and of many in one listing. */

let root: string;
let commit: string;

const git = (...args: string[]) => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();

beforeEach(async () => {
  root = await realpath(await mkdtemp(join(tmpdir(), 'variance-checkout-path-')));
  git('init', '--quiet');
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src/held.ts'), 'export {};\n');
  await writeFile(join(root, 'src/odd [name].ts'), 'export {};\n');
  git('add', '-A');
  git('-c', 'user.email=fixture@example.test', '-c', 'user.name=Fixture', 'commit', '--quiet', '-m', 'first');
  commit = git('rev-parse', 'HEAD');
});

afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});

describe('existingAt', () => {
  it('names the paths the commit held, literally, and leaves the rest out', () => {
    expect(existingAt(root, commit, ['src/held.ts', 'src/odd [name].ts', 'src/gone.ts', 'src/*.ts'])).toEqual(new Set(['src/held.ts', 'src/odd [name].ts']));
  });

  it('holds its answer across more paths than one command line carries', () => {
    const absent = Array.from({ length: 4000 }, (_, at) => `src/not-held-${at}.ts`);

    expect(existingAt(root, commit, [...absent, 'src/held.ts'])).toEqual(new Set(['src/held.ts']));
  });

  it('asks nothing of no paths, so a commit it cannot read is no refusal', () => {
    expect(existingAt(root, 'f'.repeat(40), [])).toEqual(new Set());
  });

  it('gives what git said of a commit it cannot read', () => {
    expect(existingAt(root, 'f'.repeat(40), ['src/held.ts'])).toEqual({ unread: expect.stringMatching(/^fatal: /u) });
  });
});

describe('existedAt', () => {
  it('is the same question of one path', () => {
    expect(existedAt(root, commit, 'src/held.ts')).toBe(true);
    expect(existedAt(root, commit, 'src/gone.ts')).toBe(false);
    expect(existedAt(root, commit, 'src')).toBe(true);
  });
});

describe('checkoutPath', () => {
  it('spells a path asked through `..` or from the root the way the recording does', () => {
    expect(checkoutPath(root, 'src/../src/held.ts')).toEqual({ path: 'src/held.ts' });
    expect(checkoutPath(root, join(root, 'src/held.ts'))).toEqual({ path: 'src/held.ts' });
    expect(checkoutPath(root, root)).toEqual({ path: '.' });
  });

  it('refuses a path outside the checkout with the sentence that says so', () => {
    expect(checkoutPath(root, '../elsewhere.ts')).toEqual({
      outside: `../elsewhere.ts is outside the checkout at ${root}, and the recording holds only paths inside it.`,
    });
  });
});
