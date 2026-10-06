import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SELECTION_REPORTER, SELECTION_TRANSFORM, withJourneyCoverage, withTestSelection } from './jest.js';
import { repositoryRoot } from './repository-root.js';

let temporary: string;
let repository: string;
let outside: string;

beforeAll(async () => {
  // Kept, because each test is handed a temporary directory of its own.
  temporary = tmpdir();
  repository = await mkdtemp(resolve(temporary, 'variance-authority-root-'));
  outside = await mkdtemp(resolve(tmpdir(), 'variance-authority-no-git-'));
  await mkdir(resolve(repository, 'packages/cart/src'), { recursive: true });
  execFileSync('git', ['init', '-q'], { cwd: repository });
});

afterAll(async () => {
  await rm(repository, { recursive: true, force: true });
  await rm(outside, { recursive: true, force: true });
});

describe('the root every recorded name is relative to', () => {
  it('is the checkout a package directory sits in', () => {
    expect(repositoryRoot(resolve(repository, 'packages/cart/src'))).toBe(repository);
  });

  it('keeps the spelling it was reached by, so a symlinked temporary directory still strips', () => {
    // `tmpdir()` on macOS is under `/var`, which git would report as `/private/var`.
    expect(repositoryRoot(resolve(repository, 'packages/cart')).startsWith(temporary)).toBe(true);
  });

  it('is the starting directory, without asking git, where that directory holds the checkout', async () => {
    // Every command asks it from the top of a checkout, and in a worktree from the
    // primary checkout's top as well: a directory holding `.git` is its own top.
    const top = await mkdtemp(resolve(temporary, 'variance-authority-top-'));
    const trace = resolve(top, 'trace2.json');
    try {
      execFileSync('git', ['init', '-q'], { cwd: top });
      process.env['GIT_TRACE2_EVENT'] = trace;
      try {
        expect(repositoryRoot(top)).toBe(top);
      } finally {
        delete process.env['GIT_TRACE2_EVENT'];
      }
      expect(existsSync(trace) ? (await readFile(trace, 'utf8')).split('\n').filter((line) => line.includes('"event":"start"')) : []).toEqual([]);
    } finally {
      await rm(top, { recursive: true, force: true });
    }
  });

  it('is the starting directory where git names no checkout', () => {
    expect(repositoryRoot(outside)).toBe(outside);
  });
});

describe('a Jest configuration whose rootDir is a package', () => {
  it('names files from the repository, and leaves every Jest path where Jest put it', () => {
    const rootDir = resolve(repository, 'packages/cart');
    const configured = withTestSelection(
      { rootDir, transform: { '\\.tsx?$': '@swc/jest' } },
      { coverageFile: 'coverage.bin' },
    );

    expect(configured.rootDir).toBe(rootDir);
    expect(configured.transform).toEqual({
      '\\.tsx?$': [SELECTION_TRANSFORM, { root: repository, transformer: '@swc/jest' }],
    });
    expect(configured.reporters?.at(-1)).toEqual([
      SELECTION_REPORTER,
      expect.objectContaining({ root: repository, coverageFile: resolve(rootDir, 'coverage.bin') }),
    ]);
  });

  it('writes journeys in the same space, beside the path the configuration named', () => {
    const rootDir = resolve(repository, 'packages/cart');
    const configured = withJourneyCoverage({ rootDir }, { journeyFile: 'reports/journeys.bin' });

    expect(configured.reporters?.at(-1)).toEqual([
      SELECTION_REPORTER,
      { root: repository, journeyFile: resolve(rootDir, 'reports/journeys.bin') },
    ]);
  });
});
