import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { SELECTION_REPORTER, SELECTION_TRANSFORM, withJourneyCoverage, withTestSelection } from './jest.js';
import { repositoryRoot } from './repository-root.js';

let repository: string;
let outside: string;

beforeAll(async () => {
  repository = await mkdtemp(resolve(tmpdir(), 'variance-authority-root-'));
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
    expect(repositoryRoot(resolve(repository, 'packages/cart')).startsWith(tmpdir())).toBe(true);
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
