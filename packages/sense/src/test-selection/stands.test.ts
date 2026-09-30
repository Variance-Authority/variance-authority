import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { wholeEntry, withoutFiles } from './stands.js';

/**
 * A file charged whole for a stand is read whole, so its sections are cut out
 * of the hunk diff it would otherwise be read through. Git names a file in a
 * section header quoted or bare depending on the path and `core.quotePath`,
 * and the cut has to find it either way.
 */

let at: string;

afterEach(async () => {
  await rm(at, { recursive: true, force: true });
});

/** A repository holding `src/far.ts` and `src/near.ts` at one commit, and a `git` run inside it. */
async function repository(): Promise<(...args: string[]) => string> {
  at = await mkdtemp(resolve(tmpdir(), 'va-stands-'));
  const git = (...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', '-c', 'commit.gpgsign=false', ...args], {
      cwd: at,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
  git('init', '-q', '-b', 'work');
  await mkdir(resolve(at, 'src'));
  await writeFile(resolve(at, 'src/far.ts'), 'export const far = 1;\n');
  await writeFile(resolve(at, 'src/near.ts'), 'export const near = 1;\n');
  git('add', '.');
  git('commit', '-q', '-m', 'H');
  return git;
}

describe('a file charged whole is cut out of the hunk diff by its header, however git spells it', () => {
  it('drops every section of a named file and keeps the rest', async () => {
    const git = await repository();
    await writeFile(resolve(at, 'src/far.ts'), 'export const far = 3;\n');
    await writeFile(resolve(at, 'src/near.ts'), 'export const near = 2;\n');
    const diff = git('diff', '--no-renames', 'HEAD');

    const cut = withoutFiles(diff, ['src/far.ts', 'src/*.ts']);
    expect(cut).toContain('+++ b/src/near.ts');
    expect(cut).not.toContain('src/far.ts');
    expect(withoutFiles(diff, [])).toBe(diff);
  });

  it('reads a quoted header back to the path, whether git quoted it or not', async () => {
    const git = await repository();
    await writeFile(resolve(at, 'src/été "x".ts'), '1\n');
    await writeFile(resolve(at, 'src/a b.ts'), '1\n');
    await writeFile(resolve(at, 'src/tab\tname.ts'), '1\n');
    await writeFile(resolve(at, 'src/back\\slash.ts'), '1\n');
    git('add', '.');
    const quoted = git('diff', '--cached', 'HEAD');
    expect(quoted).toContain('"a/src/\\303\\251t\\303\\251 \\"x\\".ts"');
    expect(quoted).toContain('"a/src/tab\\tname.ts"');

    for (const diff of [quoted, git('-c', 'core.quotePath=false', 'diff', '--cached', 'HEAD')]) {
      const cut = withoutFiles(diff, ['src/été "x".ts', 'src/a b.ts', 'src/tab\tname.ts', 'src/back\\slash.ts']);
      expect(cut.trim()).toBe('');
    }
    expect(wholeEntry('src/a.ts')).toBe('diff --git a/src/a.ts b/src/a.ts');
  });
});
