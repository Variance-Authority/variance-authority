import { execFileSync } from 'node:child_process';
import { mkdir, mkdtemp, stat, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, test } from 'vitest';
import {
  beforeOf,
  declaredSuites,
  parseBefore,
  parseSuites,
  readTestCoverage,
  readableTestCoverage,
  seedTestCoverage,
  testCoverageFile,
  writeTestCoverage,
  type TestCoverage,
} from './index.js';

async function repository(config?: unknown): Promise<string> {
  const at = await mkdtemp(resolve(tmpdir(), 'va-suites-'));
  execFileSync('git', ['init', '--quiet', at]);
  if (config !== undefined) await writeFile(resolve(at, 'variance.config.json'), JSON.stringify(config));

  return at;
}

const SUITES = { suites: { unit: { kind: 'unit' }, stories: { kind: 'visual' } } };

describe('the suites a repository declares', () => {
  test('are read from the root config, sorted by name', async () => {
    const at = await repository(SUITES);

    expect(declaredSuites(at)).toEqual([
      { name: 'stories', kind: 'visual' },
      { name: 'unit', kind: 'unit' },
    ]);
  });

  test('carry the carrier each one names, and none for a record that stays on the machine', () => {
    expect(parseSuites({ unit: { kind: 'unit', carry: 'actions-cache' }, stories: { kind: 'visual' } }, 'here.json')).toEqual([
      { name: 'stories', kind: 'visual' },
      { name: 'unit', kind: 'unit', carry: 'actions-cache' },
    ]);
  });

  test('are absent, not empty, when the config declares none or there is no config', async () => {
    expect(declaredSuites(await repository({ project: 'p' }))).toBeUndefined();
    expect(declaredSuites(await repository())).toBeUndefined();
  });

  test.each([
    [[], '"suites" must be an object from each suite\'s name to its kind, not []'],
    [{}, '"suites" declares no suite'],
    [{ '../up': { kind: 'unit' } }, '"suites.../up" is not a suite name'],
    [{ '.work': { kind: 'unit' } }, '"suites..work" is not a suite name'],
    [{ unit: { kind: 'smoke' } }, '"suites.unit" must be { "kind": "unit" | "integration" | "e2e" | "visual", "carry"?: "actions-cache" | "share", "before"?: [paths] }, not {"kind":"smoke"}'],
    [{ unit: { kind: 'unit', carry: 'artifact' } }, '"suites.unit" must be { "kind"'],
    [{ unit: { kind: 'unit', runner: 'jest' } }, '"suites.unit" must be { "kind"'],
    [{ unit: 'unit' }, '"suites.unit" must be { "kind"'],
    [{ unit: { kind: 'unit', before: [] } }, '"suites.unit.before" must be a non-empty list of paths, not []'],
    [{ unit: { kind: 'unit', before: ['vitest.config.ts', 3] } }, '"suites.unit.before" must be a non-empty list of paths'],
    [{ unit: { kind: 'unit', before: 'vitest.config.ts' } }, '"suites.unit.before" must be a non-empty list of paths'],
  ])('refuse %j', (value, message) => {
    expect(() => parseSuites(value, 'here.json')).toThrow(`here.json: ${message}`);
  });
});

describe('what a suite rests on before reach', () => {
  test('is declared on the suite, beside its kind', () => {
    expect(parseSuites({ unit: { kind: 'unit', before: ['vitest.config.ts', 'test/setup.ts'] } }, 'here.json')).toEqual([
      { name: 'unit', kind: 'unit', before: ['vitest.config.ts', 'test/setup.ts'] },
    ]);
  });

  test('is what every suite rests on, then what this one does', async () => {
    const at = await repository({
      before: ['.nvmrc', '.github/workflows'],
      suites: { unit: { kind: 'unit', before: ['vitest.config.ts'] }, stories: { kind: 'visual' } },
    });

    expect(beforeOf(at, 'unit')).toEqual(['.nvmrc', '.github/workflows', 'vitest.config.ts']);
    expect(beforeOf(at, 'stories')).toEqual(['.nvmrc', '.github/workflows']);
    expect(beforeOf(at, undefined)).toEqual(['.nvmrc', '.github/workflows']);
  });

  test('is nothing when nothing is declared', async () => {
    expect(beforeOf(await repository(SUITES), 'unit')).toEqual([]);
    expect(beforeOf(await repository(), undefined)).toEqual([]);
  });

  test.each([
    [[], '"before" must be a non-empty list of paths, not []'],
    [['.nvmrc', ''], '"before" must be a non-empty list of paths'],
    [{ unit: ['.nvmrc'] }, '"before" must be a non-empty list of paths'],
  ])('refuses a run-wide %j', (value, message) => {
    expect(() => parseBefore(value, 'before', 'here.json')).toThrow(`here.json: ${message}`);
  });
});

describe('where a suite records', () => {
  test('a repository that declares no suites keeps its one record', async () => {
    const at = await repository({ project: 'p' });

    expect(testCoverageFile(at, { cacheRoot: '/cache' }).endsWith('/coverage.bin')).toBe(true);
    expect(testCoverageFile(at, { cacheRoot: '/cache' })).not.toContain('/suites/');
  });

  test('each declared suite records in a directory of its own', async () => {
    const at = await repository(SUITES);
    const unit = testCoverageFile(at, { suite: 'unit', cacheRoot: '/cache' });
    const stories = testCoverageFile(at, { suite: 'stories', cacheRoot: '/cache' });

    expect(unit.endsWith('/suites/unit/coverage.bin')).toBe(true);
    expect(stories.endsWith('/suites/stories/coverage.bin')).toBe(true);
  });

  test('a suite the config does not declare is refused, and the refusal lists what it does', async () => {
    const at = await repository(SUITES);

    expect(() => testCoverageFile(at, { suite: 'checkout' })).toThrow(
      `the suite "checkout" is not declared in ${resolve(at, 'variance.config.json')}, which declares "stories", "unit"`,
    );
  });

  test('once any suite is declared, naming none is refused', async () => {
    const at = await repository(SUITES);

    expect(() => testCoverageFile(at)).toThrow('declares the suites "stories", "unit", and none is named');
  });

  test('naming a suite in a repository that declares none is refused', async () => {
    const at = await repository({ project: 'p' });

    expect(() => testCoverageFile(at, { suite: 'unit' })).toThrow(
      `the suite "unit" is named, and ${resolve(at, 'variance.config.json')} declares no suites`,
    );
  });
});

describe('a worktree and its suites', () => {
  const snapshot: TestCoverage = {
    version: 3,
    instrumentation: 'probe-recipe',
    tests: [{ file: 'a.test.ts', complete: true, preconditions: [] }],
    modules: [],
  };

  async function layered(): Promise<{ primary: string; path: string; cacheRoot: string }> {
    const at = await mkdtemp(resolve(tmpdir(), 'va-suite-layers-'));
    const primary = resolve(at, 'primary');
    await mkdir(resolve(primary, '.git', 'worktrees', 'feature'), { recursive: true });
    const path = resolve(at, 'feature');
    await mkdir(path, { recursive: true });
    await writeFile(resolve(path, '.git'), `gitdir: ${resolve(primary, '.git', 'worktrees', 'feature')}\n`);
    for (const where of [primary, path]) {
      await writeFile(resolve(where, 'variance.config.json'), JSON.stringify(SUITES));
    }

    return { primary, path, cacheRoot: resolve(at, 'cache') };
  }

  test('seeds a suite from the same suite under the base', async () => {
    const { primary, path, cacheRoot } = await layered();
    await writeTestCoverage(testCoverageFile(primary, { suite: 'unit', cacheRoot }), snapshot);
    const file = testCoverageFile(path, { suite: 'unit', cacheRoot });

    await seedTestCoverage(file, path, cacheRoot);

    expect((await readTestCoverage(file)).tests).toEqual(snapshot.tests);
  });

  test('never seeds one suite from another suite', async () => {
    const { primary, path, cacheRoot } = await layered();
    await writeTestCoverage(testCoverageFile(primary, { suite: 'unit', cacheRoot }), snapshot);
    const stories = testCoverageFile(path, { suite: 'stories', cacheRoot });

    await seedTestCoverage(stories, path, cacheRoot);

    await expect(stat(stories)).rejects.toThrow();
  });

  test('a reader of one suite finds that suite under the base', async () => {
    const { primary, path, cacheRoot } = await layered();
    await writeTestCoverage(testCoverageFile(primary, { suite: 'stories', cacheRoot }), snapshot);

    expect(await readableTestCoverage(path, { suite: 'stories', cacheRoot }))
      .toBe(testCoverageFile(primary, { suite: 'stories', cacheRoot }));
  });
});
