import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { landRun } from '@variance-authority/sense/test-selection';
import { checkout, NAMES, run, sources } from './select-standing.fixture.js';
import { diffSince } from './since.js';

// Spied, not replaced: one case fails the diff from where a test last ran, and every other diff is git's.
vi.mock('./since.js', async (original) => {
  const actual = await original<typeof import('./since.js')>();
  return { ...actual, diffSince: vi.fn(actual.diffSince) };
});

/**
 * A test placed at an earlier commit is charged what changed from there to the
 * tree. When git cannot write that diff — past its buffer on a stand far
 * behind, say — `select` stops and names the commit, rather than answering as
 * if nothing changed for the tests that ran there.
 */
describe('a test whose stand git cannot diff against the tree', () => {
  const cwd = process.cwd();

  beforeEach(() => {
    vi.stubEnv('VARIANCE_AUTHORITY_CACHE', mkdtempSync(join(tmpdir(), 'va-select-standing-cache-')));
  });

  afterEach(() => {
    process.chdir(cwd);
    vi.unstubAllEnvs();
    vi.mocked(diffSince).mockReset();
  });

  it('stops, naming the commit the test last ran at, when git cannot write the diff from there to the tree', async () => {
    // `far` last ran at P; the run at C ran `near` alone, so `far` stands at P.
    const repo = checkout();
    const P = repo.commit(sources(1, NAMES), 'P');
    await landRun(repo.file, run(repo.root, P, NAMES), repo.root);
    const C = repo.commit({ 'src/near.ts': sources(2, ['near'])['src/near.ts']! }, 'C');
    await landRun(repo.file, run(repo.root, C, ['near']), repo.root);
    const actual = await vi.importActual<typeof import('./since.js')>('./since.js');
    vi.mocked(diffSince).mockImplementation(async (ref, roots, from, options) => (from === P ? undefined : actual.diffSince(ref, roots, from, options)));

    await expect(repo.select()).rejects.toThrow(`git could not write the diff from ${P.slice(0, 12)}, where 1 test files last ran, to the tree`);
  });
});
