import { describe, expect, it } from 'vitest';
import type { OwnedFile } from '@variance-authority/sense/test-selection';
import { ownershipLines, ownershipMarkdown } from './coverage-owner-text.js';
import type { CoverageSource } from './coverage-source.js';

const SOURCE = { regions: 0, ran: 0, unloaded: { regions: 0 } } as CoverageSource;

function owned(file: string, owner: string, others: number, by: Record<string, number> = { 'apps/main': others }): OwnedFile {
  return { file, owner, regions: others + 1, run: others + 1, own: 1, others, by, kinds: {} };
}

function entries(...dirs: readonly string[]) {
  return dirs.map((from) => ({ from, own: SOURCE, uses: SOURCE }));
}

describe('the ownership report at size', () => {
  it('names five of a directory\'s files and counts the regions of the rest', () => {
    const files = [1, 2, 3, 4, 5, 6, 7].map((size) => owned(`libs/ui/src/f${size}.ts`, 'libs/ui', size));

    const lines = ownershipLines(entries('libs/ui'), files);

    expect(lines.filter((line) => /^ {4}f\d\.ts/u.test(line))).toHaveLength(5);
    expect(lines).toContainEqual(expect.stringMatching(/^ {4}and 2 more\s+3$/u));
  });

  it('walks five packages and counts the rest, leaving a package no test ran out of the table', () => {
    const packages = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].map((name) => `libs/${name}`);
    const files = packages.map((owner) => owned(`${owner}/x.ts`, owner, 1));

    const lines = ownershipLines(entries(...packages, 'libs/idle'), files);

    expect(lines).toContain('  and 1 package no test ran');
    expect(lines).toContain('  and 2 more packages; --format json lists every file');
    expect(ownershipMarkdown(entries(...packages, 'libs/idle'), files)).toContain('  and 2 more packages');
    expect(ownershipMarkdown(entries(...packages, 'libs/idle'), files)).toContain('And 1 package no test ran.');
  });

  it('names three packages that ran a region and counts the rest', () => {
    const by = { 'apps/a': 4, 'apps/b': 3, 'apps/c': 2, 'apps/d': 1 };

    const lines = ownershipLines(entries('libs/ui'), [owned('libs/ui/x.ts', 'libs/ui', 4, by)]);

    expect(lines).toContainEqual(expect.stringMatching(/apps\/a 4 · apps\/b 3 · apps\/c 2 · and 1 more$/u));
  });

  it('walks the root package from each file\'s whole path', () => {
    const lines = ownershipLines(entries('.'), [owned('tools/check.ts', '.', 2)]);

    expect(lines).toContainEqual(expect.stringMatching(/^ {2}\.\/tools\/\s+2/u));
  });

  it('says nothing when no file was counted', () => {
    expect(ownershipLines(entries('libs/ui'), [])).toEqual([]);
    expect(ownershipMarkdown(entries('libs/ui'), [])).toEqual([]);
  });
});

describe('the coverage of each package', () => {
  // The package's own count, which the coverage and every share read: 10 regions, 5 run.
  const ui = [{ from: 'libs/ui', own: { regions: 10, ran: 5, before: { regions: 1 }, unloaded: { regions: 4 } } as CoverageSource, uses: SOURCE }];
  const file: OwnedFile = {
    file: 'libs/ui/a.ts', owner: 'libs/ui', regions: 6, run: 4, own: 3, others: 1, by: { 'apps/main': 1 },
    kinds: { unit: 3, e2e: 2, integration: 0 }, near: 2,
  };

  it('parts the coverage the way its own tests contain it: within one hop, further, only by consumers, and nothing, then each kind\'s own tests', () => {
    const lines = ownershipLines(ui, [file]);

    expect(lines[1]!.split(/\s{2,}/u)).toEqual(['', 'regions', 'coverage', 'own ≤1 hop', 'own further', 'consumers only', 'nothing', 'unit', 'integration', 'e2e', 'by']);
    expect(lines[2]!.split(/\s{2,}/u)).toEqual(['', 'libs/ui', '10', '50.0%', '20.0%', '10.0%', '10.0%', '50.0%', '30.0%', '0.0%', '20.0%', 'apps/main 1']);
    expect(ownershipMarkdown(ui, [file])).toContain('| `libs/ui` | 10 | 50.0% | 20.0% | 10.0% | 10.0% | 50.0% | 30.0% | 0.0% | 20.0% | `apps/main` 1 |');
  });

  it('names what ran before reach, which is in the coverage and in no part of it', () => {
    expect(ownershipLines(ui, [file])).toContain('  1 region ran before reach: in coverage, in no part');
    expect(ownershipMarkdown(ui, [file])).toContain('1 region ran before reach: in coverage, in no part.');
  });

  it('adds every package together under `all` when there are several', () => {
    const api = [...ui, { from: 'libs/api', own: { regions: 10, ran: 10, unloaded: { regions: 0 } } as CoverageSource, uses: SOURCE }];
    const other: OwnedFile = { file: 'libs/api/b.ts', owner: 'libs/api', regions: 10, run: 10, own: 10, others: 0, by: {}, kinds: { unit: 10, e2e: 0, integration: 0 }, near: 10 };

    expect(ownershipLines(api, [file, other]).find((line) => line.startsWith('  all'))!.split(/\s{2,}/u))
      .toEqual(['', 'all', '20', '75.0%', '60.0%', '5.0%', '5.0%', '25.0%', '65.0%', '0.0%', '10.0%', 'apps/main 1']);
  });

  it('counts a package no test ran into `all`, though it has no row of its own', () => {
    const idle = { from: 'libs/idle', own: { regions: 10, ran: 0, unloaded: { regions: 10 } } as CoverageSource, uses: SOURCE };
    const api = [...ui, { from: 'libs/api', own: { regions: 10, ran: 10, unloaded: { regions: 0 } } as CoverageSource, uses: SOURCE }, idle];
    const other: OwnedFile = { file: 'libs/api/b.ts', owner: 'libs/api', regions: 10, run: 10, own: 10, others: 0, by: {}, kinds: { unit: 10, e2e: 0, integration: 0 }, near: 10 };
    const lines = ownershipLines(api, [file, other]);

    expect(lines.some((line) => line.startsWith('  libs/idle'))).toBe(false);
    expect(lines.find((line) => line.startsWith('  all'))!.split(/\s{2,}/u).slice(0, 4)).toEqual(['', 'all', '30', '50.0%']);
  });

  it('counts its own tests whole when no walk measured a distance', () => {
    const { near: _, ...unwalked } = file;

    expect(ownershipLines(ui, [unwalked])[1]!.split(/\s{2,}/u)).toEqual(['', 'regions', 'coverage', 'own', 'consumers only', 'nothing', 'unit', 'integration', 'e2e', 'by']);
  });
});
