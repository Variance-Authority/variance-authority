import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { landRun } from '@variance-authority/sense/test-selection';
import { checkout, NAMES, run, sources } from './select-standing.fixture.js';
import { diffToTree } from './since.js';

// Spied, not replaced: one case fails the diff from where a test last ran, and every other diff is git's.
vi.mock('./since.js', async (original) => {
  const actual = await original<typeof import('./since.js')>();
  return { ...actual, diffToTree: vi.fn(actual.diffToTree) };
});

/**
 * A test placed at an earlier commit is charged what changed from there to the
 * tree. When git cannot write that diff — past its buffer on a stand far
 * behind, say — nothing says what changed for the tests that ran there, so
 * each of them runs, and a note names the commit.
 */
describe('a test whose stand git cannot diff against the tree', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-select-standing-cache-')));
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
    vi.mocked(diffToTree).mockReset();
  });

  it('runs the tests that last ran at a commit git cannot diff against the tree, and names it', async () => {
    // `far` last ran at P; the run at C ran `near` alone, so `far` stands at P.
    const repo = checkout();
    const P = repo.commit(sources(1, NAMES), 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    const C = repo.commit({ 'src/near.ts': sources(2, ['near'])['src/near.ts']! }, 'C');
    await landRun(repo.file, run(repo.root, C, ['near']), repo.root);
    const actual = await vi.importActual<typeof import('./since.js')>('./since.js');
    vi.mocked(diffToTree).mockImplementation(async (from, tree, options) => (from === P ? undefined : actual.diffToTree(from, tree, options)));

    const said = await repo.select();

    // `near` ran at C, and nothing moved since; `far` runs, whatever moved since P.
    expect(said.out).toBe('test/near.test.ts\n');
    expect(said.err).toContain(`git could not write the diff from ${P.slice(0, 12)}, where 1 test file last ran, to the tree, so it runs`);
  });

  it('runs every test when git cannot write the working state as a tree, and says what git said', async () => {
    const repo = checkout();
    const P = repo.commit(sources(1, NAMES), 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    // An untracked folder that is a repository with no commit: `git add -A` refuses it.
    mkdirSync(join(repo.root, 'vendor', 'empty'), { recursive: true });
    execFileSync('git', ['init', '--quiet'], { cwd: join(repo.root, 'vendor', 'empty') });

    const said = await repo.select();

    // An empty list with `skipping nothing` is every test file.
    expect(said.out).toBe('');
    expect(said.err).toContain(`skipping nothing: git could not write the working state as a tree to read what changed since ${P.slice(0, 12)}: error: 'vendor/empty/' does not have a commit checked out`);
  });
});
