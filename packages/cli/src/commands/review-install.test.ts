import { describe, expect, it } from 'vitest';
import { relationsOfFiles } from '@variance-authority/core/relate';
import type { ExecutionIndex } from '@variance-authority/sense/test-selection';
import { installLines, packagesReached } from './review-install.js';
import type { Review } from './review.js';

/**
 * `glob.ts` imports `micromatch`, which rests on `picomatch`; `walk.ts` imports
 * `picomatch` itself as well; `clock.ts` imports `dayjs`, and no test imports
 * `clock.ts`. Only `wait.test.ts` imports `wait-for`. Nothing imports `left-pad`. A test file that runs one of these
 * depends on the package too, and is counted as a test file, not a file.
 */
const RELATIONS = relationsOfFiles(
  [
    { file: 'src/glob.ts', packages: [{ to: 'micromatch', kind: 'imports' }] },
    { file: 'src/walk.ts', packages: [{ to: 'picomatch', kind: 'imports' }, { to: 'micromatch', kind: 'imports' }] },
    { file: 'src/clock.ts', packages: [{ to: 'dayjs', kind: 'imports' }] },
    { file: 'test/glob.test.ts', edges: [{ to: 'src/glob.ts', kind: 'imports' }] },
    { file: 'test/walk.test.ts', edges: [{ to: 'src/walk.ts', kind: 'imports' }] },
    { file: 'test/wait.test.ts', packages: [{ to: 'wait-for', kind: 'imports' }] },
  ],
  { depends: [['micromatch', 'picomatch']] },
);

const INDEX: ExecutionIndex = {
  tests: [
    { id: 'glob > a', file: 'test/glob.test.ts', name: 'a' },
    { id: 'walk > a', file: 'test/walk.test.ts', name: 'a' },
    { id: 'wait > a', file: 'test/wait.test.ts', name: 'a' },
  ],
  modules: [],
};

const code = (value: string) => `\`${value}\``;

function review(packages: readonly string[]): Review {
  return {
    beyond: { packages, manifests: ['yarn.lock'], moved: [] },
    packages: packagesReached(packages, RELATIONS, INDEX),
  } as unknown as Review;
}

describe('an installed package the lockfile changed, followed into the code', () => {
  it('names the package a file imports on the way to a transitive bump', () => {
    const [reach] = packagesReached(['picomatch'], RELATIONS, INDEX);

    // `walk.ts` imports `picomatch` directly, so it is named there and not
    // again under `micromatch`: the chain is the shortest walk's own trail.
    expect(reach!.imported).toEqual([
      { chain: ['picomatch'], importers: ['src/walk.ts'] },
      { chain: ['picomatch', 'micromatch'], importers: ['src/glob.ts'] },
    ]);
    expect(reach!.tests).toEqual(['test/glob.test.ts', 'test/walk.test.ts']);
  });

  it('names a file under the package it imports even when the walk entered it from another file', () => {
    // `leaf.ts` imports `picomatch`, `top.ts` imports `leaf.ts` and
    // `micromatch`: both are one step from the walk, and whichever the walk
    // enters `top.ts` from, `top.ts` itself imports `micromatch`.
    const relations = relationsOfFiles(
      [
        { file: 'src/leaf.ts', packages: [{ to: 'picomatch', kind: 'imports' }] },
        { file: 'src/top.ts', edges: [{ to: 'src/leaf.ts', kind: 'imports' }], packages: [{ to: 'micromatch', kind: 'imports' }] },
        { file: 'src/types.ts', packages: [{ to: 'micromatch', kind: 'type' }], edges: [{ to: 'src/leaf.ts', kind: 'imports' }] },
      ],
      { depends: [['micromatch', 'picomatch']] },
    );
    const [reach] = packagesReached(['picomatch'], relations, INDEX);

    // `types.ts` names `micromatch` for its types only, which nothing runs: it
    // depends on the change through `leaf.ts`, and is counted, not named.
    expect(reach!.imported).toEqual([
      { chain: ['picomatch'], importers: ['src/leaf.ts'] },
      { chain: ['picomatch', 'micromatch'], importers: ['src/top.ts'] },
    ]);
    expect(reach!.files).toBe(3);
  });

  it('counts the files a package reaches whether or not a test runs them', () => {
    const [reach] = packagesReached(['dayjs'], RELATIONS, INDEX);

    expect(reach).toEqual({
      name: 'dayjs',
      imported: [{ chain: ['dayjs'], importers: ['src/clock.ts'] }],
      files: 1,
      tests: [],
    });
  });

  it('counts a package only test files import as theirs alone', () => {
    const [reach] = packagesReached(['wait-for'], RELATIONS, INDEX);

    expect(reach).toEqual({
      name: 'wait-for',
      imported: [{ chain: ['wait-for'], importers: ['test/wait.test.ts'] }],
      files: 0,
      tests: ['test/wait.test.ts'],
    });
    expect(installLines(review(['wait-for']), code, false)).toEqual([
      '',
      '📦 1 installed package changed. Files here depend on it. '
        + 'Each chain starts at the changed package and ends at the files that import it:',
      '',
      '  `wait-for`: 1 test file depends on it, and nothing else here does.',
      '    `wait-for` → `test/wait.test.ts`',
    ]);
  });

  it('reaches nothing from a package no file here depends on', () => {
    expect(packagesReached(['left-pad'], RELATIONS, INDEX)).toEqual([
      { name: 'left-pad', imported: [], files: 0, tests: [] },
    ]);
  });

  it('writes each chain from the changed package to the files that import its end', () => {
    expect(installLines(review(['picomatch', 'dayjs', 'left-pad']), code, true)).toEqual([
      '',
      '📦 **3 installed packages changed.** Files here depend on 2 of them. '
        + 'Each chain starts at the changed package and ends at the files that import it:',
      '',
      '- `picomatch`: 2 files depend on it, and 2 test files run them.',
      '  - `picomatch` → `src/walk.ts`',
      '  - `picomatch` → `micromatch` → `src/glob.ts`',
      '- `dayjs`: 1 file depends on it, and no test file runs it.',
      '  - `dayjs` → `src/clock.ts`',
      '',
      'No file here imports `left-pad`, or a package that depends on it.',
    ]);
  });

  it('lists twenty packages, counts the rest, and names the manifests whose entry points moved', () => {
    const names = Array.from({ length: 22 }, (_, at) => `pkg-${String(at).padStart(2, '0')}`);
    const relations = relationsOfFiles(names.map((name) => ({ file: `src/${name}.ts`, packages: [{ to: name, kind: 'imports' as const }] })));
    const wide = {
      beyond: { packages: names, manifests: ['yarn.lock'], moved: ['packages/ui/package.json'] },
      packages: packagesReached(names, relations, INDEX),
    } as unknown as Review;
    const lines = installLines(wide, (value) => value, false);

    expect(lines.filter((line) => line.startsWith('  pkg-')).map((line) => line.split(':')[0]!.trim()))
      .toEqual(names.slice(0, 20));
    expect(lines.slice(-3)).toEqual([
      '  2 more, not listed here; `--format json` lists every one.',
      '',
      'Manifests whose entry points changed: packages/ui/package.json.',
    ]);
  });

  it('names the packages alone when the review carries no reach', () => {
    const bare = { beyond: { packages: ['picomatch'], manifests: ['yarn.lock'], moved: [] } } as unknown as Review;

    expect(installLines(bare, (value) => value, false)).toEqual(['', '📦 1 installed package changed. picomatch.']);
  });

  it('says why when the install could not be compared', () => {
    const whole = { beyond: { whole: 'no lockfile at the base' } } as unknown as Review;

    expect(installLines(whole, code, true)).toEqual(['', '📦 Installed packages could not be compared (no lockfile at the base).']);
  });
});
