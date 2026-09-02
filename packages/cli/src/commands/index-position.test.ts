import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { indexPosition } from './since.js';

/**
 * The coordinate a report carries so a reader can price narrowing.
 *
 * A probe, and every assertion here is about that word. `changedSince` throws
 * when `git` cannot answer, because a run is about to skip subjects on the
 * strength of the answer. Nothing is skipped on the strength of this one: it is
 * read to be printed, and a coordinate that cannot be read is one the header
 * leaves out. So the failures below are all the same failure — `undefined`, not
 * a throw, and never a number nobody can stand behind.
 */

const { commitOfIndex } = vi.hoisted(() => ({ commitOfIndex: vi.fn() }));

vi.mock('@variance-authority/sense/test-selection', () => ({
  testCoverageFile: () => '/nowhere/coverage.bin',
  readTestCoverage: commitOfIndex,
}));

const cwd = process.cwd();
afterEach(() => {
  process.chdir(cwd);
  commitOfIndex.mockReset();
});

/** A checkout with one commit, and the ref it landed on. */
function checkout(files: Readonly<Record<string, string>>): { root: string; head: string } {
  const root = mkdtempSync(join(tmpdir(), 'va-position-'));
  const git = (args: readonly string[]): string =>
    execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  git(['init', '--quiet', '--initial-branch', 'main']);
  git(['config', 'user.email', 'fixture@example.test']);
  git(['config', 'user.name', 'Fixture']);
  for (const [path, body] of Object.entries(files)) {
    mkdirSync(join(root, path, '..'), { recursive: true });
    writeFileSync(join(root, path), body);
  }
  git(['add', '-A']);
  git(['commit', '--quiet', '-m', 'the state this index stands at']);
  return { root, head: git(['rev-parse', 'HEAD']) };
}

describe('where the recorded execution index stands', () => {
  it('measures the distance to the tree on disk, uncommitted edits included', async () => {
    // Two-dot and against the working tree. The index names the exact commit it
    // was written at, so there is no merge base to find and nothing here has to
    // guess which branch a reader thinks they are on.
    const { root, head } = checkout({ 'src/a.ts': 'export const a = 1;\n' });
    commitOfIndex.mockResolvedValue({ commit: head });

    writeFileSync(join(root, 'src/a.ts'), 'export const a = 2;\n');
    writeFileSync(join(root, 'src/b.ts'), 'export const b = 1;\n');
    execFileSync('git', ['add', '-A'], { cwd: root, stdio: 'pipe' });

    expect(await indexPosition(root)).toEqual({ commit: head, changed: 2 });
  });

  it('says nothing rather than zero when the index has no position', async () => {
    // `changed: 0` is a claim: the tree has not moved. An index recorded outside
    // a checkout supports no claim at all, and a header offering `--since` on
    // the strength of it would be offering a ref that does not exist.
    const { root } = checkout({ 'src/a.ts': 'export const a = 1;\n' });
    commitOfIndex.mockResolvedValue({});

    expect(await indexPosition(root)).toBeUndefined();
  });

  it('says nothing when there is no index, and when git will not answer', async () => {
    const { root } = checkout({ 'src/a.ts': 'export const a = 1;\n' });

    commitOfIndex.mockRejectedValue(new Error('ENOENT'));
    expect(await indexPosition(root)).toBeUndefined();

    commitOfIndex.mockResolvedValue({ commit: 'a'.repeat(40) });
    expect(await indexPosition(root)).toBeUndefined();
  });
});
