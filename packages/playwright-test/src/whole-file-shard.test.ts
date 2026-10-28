import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import type { FullConfig, Suite, TestRun } from '@playwright/test/reporter';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import ExecutionReporter from './reporter.js';
import { installedPlaywright, reporterArgument } from './whole-file-shard.js';

let root: string;
let said: string[];

beforeEach(async () => {
  root = await mkdtemp(resolve(tmpdir(), 'variance-playwright-shard-'));
  said = [];
  vi.spyOn(process.stderr, 'write').mockImplementation((line) => {
    said.push(String(line));
    return true;
  });
});

afterEach(async () => {
  vi.restoreAllMocks();
  await rm(root, { recursive: true, force: true });
});

interface Project {
  readonly name: string;
  readonly files: readonly string[];
  readonly dependencies?: readonly string[];
}

/** A root suite as Playwright hands `preprocess` one: projects, each holding file suites. */
function suiteOf(projects: readonly Project[]): Suite {
  const rootSuite = { type: 'root', title: '', suites: [] as unknown[] };
  for (const project of projects) {
    const projectSuite = {
      type: 'project',
      title: project.name,
      parent: rootSuite,
      project: () => ({ name: project.name, dependencies: project.dependencies ?? [], teardown: undefined }),
      suites: [] as unknown[],
    };
    projectSuite.suites = project.files.map((file) => ({
      type: 'file',
      title: file,
      parent: projectSuite,
      location: { file: resolve(root, file), line: 0, column: 0 },
      suites: [],
    }));
    rootSuite.suites.push(projectSuite);
  }
  return rootSuite as unknown as Suite;
}

/** What one shard keeps: every file suite and project suite it did not exclude, by project and title. */
async function shard(projects: readonly Project[], current: number | undefined, total = 2) {
  const suite = suiteOf(projects);
  const excluded = new Set<unknown>();
  const testRun = { skipSharding: vi.fn(), exclude: vi.fn((target: unknown) => excluded.add(target)) };
  const reporter = new ExecutionReporter({ root, coverageFile: resolve(root, 'coverage.bin') });
  const config = { shard: current === undefined ? null : { current, total }, version: '1.62.1' } as unknown as FullConfig;
  await reporter.preprocess({ config, suite, testRun: testRun as unknown as TestRun });
  const kept = suite.suites.flatMap((project) =>
    excluded.has(project) ? [] : project.suites.filter((file) => !excluded.has(file)).map((file) => `${project.title}:${file.title}`),
  );
  return { kept, testRun, excluded };
}

const files = ['tests/a.spec.ts', 'tests/b.spec.ts', 'tests/c.spec.ts', 'tests/d.spec.ts'];

describe('the reporter that places a Playwright shard by whole files', () => {
  it('leaves a run that asked for no shard alone', async () => {
    const { kept, testRun } = await shard([{ name: 'chromium', files }], undefined);

    expect(kept).toHaveLength(4);
    expect(testRun.skipSharding).not.toHaveBeenCalled();
    expect(testRun.exclude).not.toHaveBeenCalled();
    expect(said).toEqual([]);
  });

  it('turns Playwright\'s own split off and keeps each file, in every project, on one shard', async () => {
    const projects = [{ name: 'chromium', files }, { name: 'firefox', files }];

    const first = await shard(projects, 1);
    const second = await shard(projects, 2);

    expect(first.testRun.skipSharding).toHaveBeenCalledTimes(1);
    expect(second.testRun.skipSharding).toHaveBeenCalledTimes(1);
    expect([...first.kept, ...second.kept].sort()).toEqual(projects.flatMap((project) => files.map((file) => `${project.name}:${file}`)).sort());
    const fileOf = (kept: readonly string[]) => new Set(kept.map((one) => one.split(':')[1]));
    expect([...fileOf(first.kept)].filter((file) => fileOf(second.kept).has(file))).toEqual([]);
    for (const part of [first.kept, second.kept]) {
      for (const file of fileOf(part)) expect(part).toEqual(expect.arrayContaining([`chromium:${file}`, `firefox:${file}`]));
    }
    expect(said[0]).toMatch(/^variance-authority: shard 1\/2 by file count: 2 of 4 files; no times at .*\n$/);
    expect(said[1]).toMatch(/^variance-authority: shard 2\/2 by file count: 2 of 4 files; /);
  });

  it('counts the copies `repeatEach` makes of a file as that one file, and keeps them on one shard', async () => {
    // Playwright hands a repeated file in as one file suite per repeat, each at the same path.
    const projects = [{ name: 'chromium', files: [...files, ...files] }];

    const first = await shard(projects, 1);
    const second = await shard(projects, 2);

    expect(first.kept).toHaveLength(4);
    expect(second.kept).toHaveLength(4);
    for (const part of [first.kept, second.kept]) {
      for (const file of new Set(part)) expect(part.filter((one) => one === file)).toHaveLength(2);
    }
    expect(said[0]).toMatch(/^variance-authority: shard 1\/2 by file count: 2 of 4 files; /);
  });

  it('never excludes from a setup project, and does not place its files', async () => {
    const projects = [
      { name: 'setup', files: ['tests/auth.setup.ts'] },
      { name: 'chromium', files, dependencies: ['setup'] },
    ];

    const first = await shard(projects, 1);
    const second = await shard(projects, 2);

    expect(first.kept).toContain('setup:tests/auth.setup.ts');
    expect(second.kept).toContain('setup:tests/auth.setup.ts');
    expect(said[0]).toContain('of 4 files');
  });

  it('excludes a project whole when none of its files are this shard\'s', async () => {
    const projects = [{ name: 'chromium', files }, { name: 'mobile', files: ['tests/a.spec.ts'] }];

    const parts = await Promise.all([1, 2].map(async (current) => shard(projects, current)));
    const without = parts.find((part) => !part.kept.includes('mobile:tests/a.spec.ts'))!;

    expect([...without.excluded].some((target) => (target as Suite).type === 'project')).toBe(true);
  });

  it('reads the reporters a command line names, which replace the configuration\'s', () => {
    expect(reporterArgument(['node', 'cli.js', 'test', '--reporter', 'dot,list'])).toEqual(['dot', 'list']);
    expect(reporterArgument(['node', 'cli.js', 'test', '--reporter=dot'])).toEqual(['dot']);
    expect(reporterArgument(['node', 'cli.js', 'test'])).toBeUndefined();
  });

  it('reads the Playwright installed beside this package when the configuration\'s package resolves none', async () => {
    await writeFile(resolve(root, 'package.json'), '{}');
    const beside = (createRequire(import.meta.url)('@playwright/test/package.json') as { version: string }).version;

    expect(installedPlaywright(root)).toBe(beside);
  });
});
