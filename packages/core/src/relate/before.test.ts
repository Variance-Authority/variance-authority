import { describe, expect, it } from 'vitest';
import { beforeReach, changedBefore, relationsOfFiles, within, type FileRecord } from './index.js';

/**
 * The far-left end of the line, and the two ways it can be wrong.
 *
 * Too narrow is the dangerous one: a harness that reaches nothing is a whole
 * suite skipped over the file that governs it, and it fails silently — a green
 * run over a surface nobody looked at. Too wide only costs time, and every case
 * here that could go either way is asserted in that direction.
 *
 * `vitest.config.ts` loads `test/setup.ts`, which loads a fixture and rests on
 * `jest-environment-jsdom`; the install says that package rests on `jsdom`. The
 * setup also imports `src/theme.ts`, which the component scan already holds.
 */
const SUITE: readonly FileRecord[] = [
  {
    file: 'vitest.config.ts',
    edges: [{ to: 'test/setup.ts', kind: 'imports' }],
    packages: [{ to: 'jest-environment-jsdom', kind: 'imports' }],
  },
  {
    file: 'test/setup.ts',
    edges: [
      { to: 'test/fixtures.ts', kind: 'imports' },
      { to: 'src/theme.ts', kind: 'imports' },
      { to: 'test/kinds.ts', kind: 'type' },
    ],
  },
  { file: 'test/fixtures.ts' },
  { file: 'test/kinds.ts' },
  { file: 'src/theme.ts', edges: [{ to: 'src/tokens.css', kind: 'asset' }] },
  { file: 'src/tokens.css' },
  { file: 'src/Button.tsx', declares: ['Button'], edges: [{ to: 'src/theme.ts', kind: 'imports' }] },
];

const RELATIONS = relationsOfFiles(SUITE, { depends: [['jest-environment-jsdom', 'jsdom']] });

describe('what a run rests on', () => {
  it('walks down from a declared entry point and collects what it loads', () => {
    const before = beforeReach(RELATIONS, ['vitest.config.ts'], { sensed: ['src'] });

    expect([...before.files].sort()).toEqual(['test/fixtures.ts', 'test/setup.ts', 'vitest.config.ts']);
    expect(before.unread).toEqual([]);
  });

  it('carries into the package layer, transitively', () => {
    const before = beforeReach(RELATIONS, ['vitest.config.ts'], { sensed: ['src'] });

    // The mixed case in one line: no file in the repository writes the word
    // `jsdom`, and a bump of it moves the environment the whole suite runs in.
    expect([...before.packages].sort()).toEqual(['jest-environment-jsdom', 'jsdom']);
  });

  it('stops at the first file the scan already answers for', () => {
    const before = beforeReach(RELATIONS, ['vitest.config.ts'], { sensed: ['src'] });

    // `src/theme.ts` has dependents, so a change to it is answered exactly by
    // walking them. Pulling it in here would trade that for a whole run — and
    // what lies below it must not come either, or the stop is decorative.
    expect(before.files.has('src/theme.ts')).toBe(false);
    expect(before.files.has('src/tokens.css')).toBe(false);
  });

  it('puts the repository in front of the harness when nothing is sensed', () => {
    const before = beforeReach(RELATIONS, ['vitest.config.ts']);

    expect(before.files.has('src/theme.ts')).toBe(true);
  });

  it('does not follow a type-only edge, which is erased before the suite runs', () => {
    const before = beforeReach(RELATIONS, ['vitest.config.ts'], { sensed: ['src'] });

    expect(before.files.has('test/kinds.ts')).toBe(false);
  });

  it('reports an entry the graph does not hold rather than guessing at it', () => {
    const before = beforeReach(RELATIONS, ['.nvmrc', 'vitest.config.ts'], { sensed: ['src'] });

    expect(before.unread).toEqual(['.nvmrc']);
    // Reported, not refused: the closure of a `.nvmrc` is empty because there is
    // nothing under it to read, and the walk from the entry beside it still ran.
    expect(before.files.has('test/setup.ts')).toBe(true);
  });

  it('answers nothing for no entry points, which is the repository that declared none', () => {
    const before = beforeReach(RELATIONS, []);

    expect([...before.files]).toEqual([]);
    expect([...before.packages]).toEqual([]);
  });
});

describe('what a diff changed before reach', () => {
  const before = beforeReach(RELATIONS, ['.github/workflows', 'vitest.config.ts'], { sensed: ['src'] });

  it('names a file the walk found, and says nothing about one it did not', () => {
    expect(changedBefore(before, ['test/setup.ts', 'src/Button.tsx'])).toEqual(['test/setup.ts']);
  });

  it('claims everything under a declared entry, so a directory is one line of config', () => {
    expect(changedBefore(before, ['.github/workflows/ci.yml'])).toEqual(['.github/workflows/ci.yml']);
  });

  it('names a package the harness rests on, and leaves the rest of the install alone', () => {
    expect(changedBefore(before, [], ['jsdom', 'react'])).toEqual(['jsdom']);
  });

  it('is empty when the diff changed nothing the run rests on', () => {
    expect(changedBefore(before, ['src/Button.tsx'], ['react'])).toEqual([]);
  });
});

describe('the directory boundary', () => {
  it('is drawn on directories, not characters', () => {
    expect(within('src/Button.tsx', ['src'])).toBe(true);
    expect(within('src', ['src'])).toBe(true);
    expect(within('srcery/Button.tsx', ['src'])).toBe(false);
    expect(within('src/Button.tsx', ['src/'])).toBe(true);
    expect(within('anything.ts', ['.'])).toBe(true);
    expect(within('src/Button.tsx', [])).toBe(false);
  });
});
