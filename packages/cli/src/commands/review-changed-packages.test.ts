import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { changedPackagesMarkdown, changedPackagesOf, type ChangedPackage } from './review-changed-packages.js';
import { formatReview } from './review-text.js';
import type { Reach, Review, ReviewFile, ReviewRegion } from './review.js';

const region = (kind: string, name: string, startLine: number, endLine: number, reach: Reach, tests: readonly string[] = []): ReviewRegion => ({
  kind,
  name,
  startLine,
  endLine,
  reach,
  edit: 'new',
  cases: tests.length,
  changedLineCases: tests.length,
  tests: [...tests].sort(),
  called: [],
});

/** A workspace with a named package, a nameless one, and code under no manifest at all. */
async function workspace(): Promise<string> {
  const root = await mkdtemp(join(tmpdir(), 'va-changed-packages-'));
  await mkdir(join(root, 'packages/a/src'), { recursive: true });
  await mkdir(join(root, 'packages/b/src'), { recursive: true });
  await writeFile(join(root, 'packages/a/package.json'), JSON.stringify({ name: '@x/a' }));
  await writeFile(join(root, 'packages/b/package.json'), '{}');
  return root;
}

const mark = (reach: Reach): string => (reach === 'near' ? 'G' : reach === 'far' ? 'Y' : 'R');

const pkg = (name: string, functions: number, reaches: ChangedPackage['reaches'], tests: readonly string[] = [name], importers = 0): ChangedPackage =>
  ({ package: name, path: `packages/${name}`, functions, reaches, own: tests.includes(name), tests: tests.filter((test) => test !== name), importers });

describe('where a change lands, a package at a time', () => {
  it('groups changed functions by the manifest above them and names the packages whose tests entered them', async () => {
    const root = await workspace();
    const files: ReviewFile[] = [
      { file: 'packages/a/src/x.ts', regions: [region('function', 'f', 1, 5, 'near', ['packages/a/test/x.test.ts', 'packages/b/test/y.test.ts'])] },
      { file: 'packages/b/src/y.ts', regions: [region('function', 'g', 1, 5, 'far', ['packages/b/test/y.test.ts'])] },
      { file: 'tools/run.ts', regions: [region('function', 'run', 1, 5, 'unwalked')] },
    ];
    const dependents = (changed: readonly string[]): readonly string[] =>
      changed.includes('packages/a/src/x.ts') ? ['packages/a/src/x.ts', 'packages/b/src/z.ts', 'tools/run.ts'] : changed;

    expect(changedPackagesOf(root, files, dependents)).toEqual([
      { package: '.', path: '.', functions: 1, reaches: { unwalked: 1 }, own: false, tests: [], importers: 0 },
      { package: '@x/a', path: 'packages/a', functions: 1, reaches: { near: 1 }, own: true, tests: ['packages/b'], importers: 2 },
      { package: 'packages/b', path: 'packages/b', functions: 1, reaches: { far: 1 }, own: true, tests: [], importers: 0 },
    ]);
  });

  it('counts a function once, as uncovered, when a case ran it and none ran a branch in it', async () => {
    const root = await workspace();
    const files: ReviewFile[] = [{
      file: 'packages/a/src/x.ts',
      regions: [region('module', '', 1, 40, 'near', ['packages/a/test/x.test.ts']), region('function', 'cap', 3, 20, 'near', ['packages/a/test/x.test.ts']), region('branch', 'cap', 9, 9, 'unwalked')],
    }];

    expect(changedPackagesOf(root, files, (changed) => changed)).toEqual([
      { package: '@x/a', path: 'packages/a', functions: 1, reaches: { unwalked: 1 }, own: true, tests: [], importers: 0 },
    ]);
  });

  it('tells a package\'s own tests from another package\'s of the same name by where they live', async () => {
    const root = await workspace();
    await mkdir(join(root, 'fixtures/a'), { recursive: true });
    await writeFile(join(root, 'fixtures/a/package.json'), JSON.stringify({ name: '@x/a' }));
    const files: ReviewFile[] = [{ file: 'packages/a/src/x.ts', regions: [region('function', 'f', 1, 5, 'far', ['fixtures/a/x.test.ts'])] }];

    expect(changedPackagesOf(root, files, (changed) => changed)).toEqual([
      { package: '@x/a', path: 'packages/a', functions: 1, reaches: { far: 1 }, own: false, tests: ['@x/a'], importers: 0 },
    ]);
  });

  it('leaves the importers out when the import graph does not hold the changed files', async () => {
    const root = await workspace();
    const files: ReviewFile[] = [{ file: 'packages/a/src/x.ts', regions: [region('function', 'f', 1, 5, 'near', ['packages/a/test/x.test.ts'])] }];

    expect(changedPackagesOf(root, files, () => undefined)).toEqual([
      { package: '@x/a', path: 'packages/a', functions: 1, reaches: { near: 1 }, own: true, tests: [] },
    ]);
    expect(changedPackagesMarkdown([{ ...pkg('a', 1, { far: 1 }), importers: undefined }, pkg('b', 1, { near: 1 })], mark).slice(5, 6)).toEqual(['| `a` | 1 | Y 1 | own |  |']);
  });

  it('prints nothing for a change that lands in one package', () => {
    expect(changedPackagesMarkdown([pkg('a', 2, { near: 2 })], mark)).toEqual([]);
  });

  it('puts the packages with gaps first, a package\'s own tests first among the ones that entered it', () => {
    expect(changedPackagesMarkdown([
      pkg('a', 3, { near: 2, unwalked: 1 }, ['a', 'b'], 2),
      pkg('b', 2, { near: 2 }),
      pkg('c', 1, { far: 1 }, ['a'], 1),
      pkg('d', 2, { hole: 1, unknown: 1 }, []),
    ], mark).join('\n')).toBe([
      '',
      '**Where this change lands:** 8 changed functions in 4 packages.',
      '',
      '| Package | Changed functions | Ran | Tests from | Packages importing it |',
      '|---|--:|---|---|--:|',
      '| `d` | 2 | R 2 | none | 0 |',
      '| `a` | 3 | G 2 · R 1 | own, `b` | 2 |',
      '| `c` | 1 | Y 1 | `a` | 1 |',
      '| `b` | 2 | G 2 | own | 0 |',
    ].join('\n'));
  });

  it('folds the packages whose every function a nearby test ran into one row, once there are more than fit', () => {
    const gaps = [pkg('g1', 1, { unwalked: 1 }, []), pkg('g2', 1, { far: 1 }), pkg('g3', 2, { near: 1, unplaced: 1 })];
    const clean = Array.from({ length: 11 }, (_, at) => pkg(`c${String(at).padStart(2, '0')}`, 2, { near: 2 }, undefined, at));
    const lines = changedPackagesMarkdown([...clean, ...gaps], mark);

    expect(lines.slice(5)).toEqual([
      '| `g1` | 1 | R 1 | none | 0 |',
      '| `g3` | 2 | G 1 · R 1 | own | 0 |',
      '| `g2` | 1 | Y 1 | own | 0 |',
      '| 11 more packages, every function G | 22 | G 22 | | |',
      '',
      'Each package is in the review\'s JSON, under `changedPackages`.',
    ]);
  });

  it('folds a change whose every package a nearby test ran into one row', () => {
    const clean = Array.from({ length: 11 }, (_, at) => pkg(`c${String(at).padStart(2, '0')}`, 1, { near: 1 }));

    expect(changedPackagesMarkdown(clean, mark).slice(5, 6)).toEqual(['| 11 packages, every function G | 11 | G 11 | | |']);
  });

  it('keeps the table to its budget, the fold rows counted in it', () => {
    const gaps = Array.from({ length: 12 }, (_, at) => pkg(`g${String(at).padStart(2, '0')}`, 1, { far: 1 }));
    const alone = changedPackagesMarkdown(gaps, mark);
    const beside = changedPackagesMarkdown([...gaps, pkg('c', 1, { near: 1 })], mark);

    expect(alone.slice(5, -2)).toHaveLength(10);
    expect(alone.slice(-3)).toEqual(['| 3 more packages | 3 | Y 3 | | |', '', 'Each package is in the review\'s JSON, under `changedPackages`.']);
    expect(beside.slice(5, -2)).toHaveLength(10);
    expect(beside.slice(-4, -2)).toEqual(['| 4 more packages | 4 | Y 4 | | |', '| 1 more package, every function G | 1 | G 1 | | |']);
  });

  it('follows the verdict in the comment, the marks said once under it', () => {
    const files: ReviewFile[] = [
      { file: 'packages/a/src/x.ts', regions: [region('function', 'f', 1, 5, 'near', ['packages/a/test/x.test.ts'])] },
      { file: 'packages/b/src/y.ts', regions: [region('function', 'g', 1, 5, 'unwalked')] },
    ];
    const markdown = formatReview({
      from: 'abc', record: 'ran', base: 'since', files, changedPackages: [pkg('a', 1, { near: 1 }), pkg('b', 1, { unwalked: 1 }, [])],
    } as unknown as Review, 'markdown');

    expect(markdown).toContain('`g`.\n\n**Where this change lands:** 2 changed functions in 2 packages.');
    expect(markdown).toContain('| `b` | 1 | 🔴 1 | none | 0 |\n| `a` | 1 | 🟢 1 | own | 0 |\n\n<sub>🟢 a test importing the file ran it');
    expect(markdown.split('🟢 a test importing the file ran it')).toHaveLength(2);
  });
});
