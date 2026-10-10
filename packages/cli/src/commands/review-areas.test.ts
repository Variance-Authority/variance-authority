import { mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { areasMarkdown, areasOf, type ReviewArea } from './review-areas.js';
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
  const root = await mkdtemp(join(tmpdir(), 'va-areas-'));
  await mkdir(join(root, 'packages/a/src'), { recursive: true });
  await mkdir(join(root, 'packages/b/src'), { recursive: true });
  await writeFile(join(root, 'packages/a/package.json'), JSON.stringify({ name: '@x/a' }));
  await writeFile(join(root, 'packages/b/package.json'), '{}');
  return root;
}

const mark = (reach: Reach): string => (reach === 'near' ? 'G' : reach === 'far' ? 'Y' : 'R');

const area = (name: string, functions: number, reaches: ReviewArea['reaches'], tests: readonly string[] = [name], importers = 0): ReviewArea =>
  ({ package: name, path: `packages/${name}`, functions, reaches, tests, importers });

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

    expect(areasOf(root, files, dependents)).toEqual([
      { package: '.', path: '.', functions: 1, reaches: { unwalked: 1 }, tests: [], importers: 0 },
      { package: '@x/a', path: 'packages/a', functions: 1, reaches: { near: 1 }, tests: ['@x/a', 'packages/b'], importers: 2 },
      { package: 'packages/b', path: 'packages/b', functions: 1, reaches: { far: 1 }, tests: ['packages/b'], importers: 0 },
    ]);
  });

  it('counts a function once, as uncovered, when a case ran it and none ran a branch in it', async () => {
    const root = await workspace();
    const files: ReviewFile[] = [{
      file: 'packages/a/src/x.ts',
      regions: [region('module', '', 1, 40, 'near', ['packages/a/test/x.test.ts']), region('function', 'cap', 3, 20, 'near', ['packages/a/test/x.test.ts']), region('branch', 'cap', 9, 9, 'unwalked')],
    }];

    expect(areasOf(root, files, (changed) => changed)).toEqual([
      { package: '@x/a', path: 'packages/a', functions: 1, reaches: { unwalked: 1 }, tests: ['@x/a'], importers: 0 },
    ]);
  });

  it('prints nothing for a change that lands in one package', () => {
    expect(areasMarkdown([area('a', 2, { near: 2 })], mark)).toEqual([]);
  });

  it('puts the packages with gaps first, a package\'s own tests first among the ones that entered it', () => {
    expect(areasMarkdown([
      area('a', 3, { near: 2, unwalked: 1 }, ['a', 'b'], 2),
      area('b', 2, { near: 2 }),
      area('c', 1, { far: 1 }, ['a'], 1),
      area('d', 2, { hole: 1, unknown: 1 }, []),
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
    const gaps = [area('g1', 1, { unwalked: 1 }, []), area('g2', 1, { far: 1 }), area('g3', 2, { near: 1, unplaced: 1 })];
    const clean = Array.from({ length: 11 }, (_, at) => area(`c${String(at).padStart(2, '0')}`, 2, { near: 2 }, undefined, at));
    const lines = areasMarkdown([...clean, ...gaps], mark);

    expect(lines.slice(5)).toEqual([
      '| `g1` | 1 | R 1 | none | 0 |',
      '| `g3` | 2 | G 1 · R 1 | own | 0 |',
      '| `g2` | 1 | Y 1 | own | 0 |',
      '| 11 more packages, every function G | 22 | G 22 | | |',
      '',
      'Each package is in the review\'s JSON, under `areas`.',
    ]);
  });

  it('folds a change whose every package a nearby test ran into one row', () => {
    const clean = Array.from({ length: 11 }, (_, at) => area(`c${String(at).padStart(2, '0')}`, 1, { near: 1 }));

    expect(areasMarkdown(clean, mark).slice(5, 6)).toEqual(['| 11 packages, every function G | 11 | G 11 | | |']);
  });

  it('keeps the table to its budget, the fold rows counted in it', () => {
    const gaps = Array.from({ length: 12 }, (_, at) => area(`g${String(at).padStart(2, '0')}`, 1, { far: 1 }));
    const alone = areasMarkdown(gaps, mark);
    const beside = areasMarkdown([...gaps, area('c', 1, { near: 1 })], mark);

    expect(alone.slice(5, -2)).toHaveLength(10);
    expect(alone.slice(-3)).toEqual(['| 3 more packages | 3 | Y 3 | | |', '', 'Each package is in the review\'s JSON, under `areas`.']);
    expect(beside.slice(5, -2)).toHaveLength(10);
    expect(beside.slice(-4, -2)).toEqual(['| 4 more packages | 4 | Y 4 | | |', '| 1 more package, every function G | 1 | G 1 | | |']);
  });

  it('follows the verdict in the comment, the marks said once under it', () => {
    const files: ReviewFile[] = [
      { file: 'packages/a/src/x.ts', regions: [region('function', 'f', 1, 5, 'near', ['packages/a/test/x.test.ts'])] },
      { file: 'packages/b/src/y.ts', regions: [region('function', 'g', 1, 5, 'unwalked')] },
    ];
    const markdown = formatReview({
      from: 'abc', record: 'ran', base: 'since', files, areas: [area('a', 1, { near: 1 }), area('b', 1, { unwalked: 1 }, [])],
    } as unknown as Review, 'markdown');

    expect(markdown).toContain('`g`.\n\n**Where this change lands:** 2 changed functions in 2 packages.');
    expect(markdown).toContain('| `b` | 1 | 🔴 1 | none | 0 |\n| `a` | 1 | 🟢 1 | own | 0 |\n\n<sub>🟢 a test importing the file ran it');
    expect(markdown.split('🟢 a test importing the file ran it')).toHaveLength(2);
  });
});
