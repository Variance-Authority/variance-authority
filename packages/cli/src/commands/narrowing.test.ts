import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { narrowingFor } from './narrowing.js';

/**
 * A run given refs, resolved in a real checkout: a branch off `main`, with
 * `older` one commit behind `main`, so a diff from each of the two refs names a
 * different set of files.
 */

const cwd = process.cwd();
let root: string;

function git(args: readonly string[]): void {
  execFileSync('git', args, { cwd: root, stdio: 'pipe' });
}

function commit(files: Readonly<Record<string, string>>, message: string): void {
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', message]);
}

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'variance-narrowing-')));
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  commit({ 'src/a.ts': 'export const a = 1;\n' }, 'first');
  git(['tag', 'older']);
  commit({ 'src/b.ts': 'export const b = 1;\n' }, 'second');
  git(['checkout', '--quiet', '-b', 'feature']);
  commit({ 'src/a.ts': 'export const a = 2;\n' }, 'on the branch');
  process.chdir(root);
});

afterEach(() => process.chdir(cwd));

describe('the refs a run narrows by', () => {
  it('reads the files and the hunks `--since` names from where that ref parts', async () => {
    const narrowing = await narrowingFor({ since: 'main', relations: false }, []);

    expect(narrowing.since?.ref).toBe('main');
    expect(narrowing.since?.changed).toEqual(['src/a.ts']);
    expect(narrowing.since?.diff).toContain('@@ -1 +1 @@\n-export const a = 1;\n+export const a = 2;');
    expect(narrowing.against).toBeUndefined();
  });

  it('reads `--against` from its own ref when it names another one than `--since`', async () => {
    const narrowing = await narrowingFor({ since: 'main', against: 'older', relations: false }, []);

    expect(narrowing.since?.changed).toEqual(['src/a.ts']);
    expect(narrowing.against?.ref).toBe('older');
    expect(narrowing.against?.changed).toEqual(['src/a.ts', 'src/b.ts']);
  });
});
