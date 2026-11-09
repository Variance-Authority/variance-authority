import { describe, expect, it } from 'vitest';
import type { OwnedFile } from '@variance-authority/sense/test-selection';
import { coverageLines, coverageMarkdown, ownershipLines, ownershipMarkdown } from './coverage-owner-text.js';
import type { CoverageSource } from './coverage-source.js';

const SOURCE = {} as CoverageSource;

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
  const ui = [{ from: 'libs/ui', own: { regions: 10, ran: 6 } as CoverageSource, uses: SOURCE }];
  const file: OwnedFile = {
    file: 'libs/ui/a.ts', owner: 'libs/ui', regions: 6, run: 4, own: 3, others: 1, by: { 'apps/main': 1 },
    kinds: { unit: 3, e2e: 2, integration: 0 }, nearest: { 0: 1, 1: 1, 3: 1 }, unmeasured: 1,
  };

  it('shares every count over the package\'s regions: by any test, by its own, per kind of suite, and within each distance', () => {
    const lines = coverageLines(ui, [file]);

    expect(lines[1]!.split(/\s{2,}/u)).toEqual(['', 'regions', 'coverage', 'own tests', 'unit', 'integration', 'e2e', '≤1 hop', '≤2 hops', '≤3 hops']);
    expect(lines[2]!.split(/\s{2,}/u)).toEqual(['', 'libs/ui', '10', '60.0%', '30.0%', '30.0%', '0.0%', '20.0%', '20.0%', '20.0%', '30.0%']);
    expect(coverageMarkdown(ui, [file])).toContain('| `libs/ui` | 10 | 60.0% | 30.0% | 30.0% | 0.0% | 20.0% | 20.0% | 20.0% | 30.0% |');
  });

  it('leaves the distance columns out when no walk measured one', () => {
    const { nearest: _, unmeasured: __, ...unwalked } = file;

    expect(coverageLines(ui, [unwalked])[1]).not.toContain('hop');
  });
});
