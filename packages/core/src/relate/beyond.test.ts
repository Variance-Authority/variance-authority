import { describe, expect, it } from 'vitest';
import { beforeReach, beyondReach, changedBefore, relationsOfFiles, type FileRecord } from './index.js';

/**
 * The far-right end of the line, read back into files.
 *
 * `test/setup.ts` imports `jest-environment-jsdom`, which the install says rests
 * on `jsdom`. `src/Button.tsx` imports `react` and only the types of
 * `@mui/material`. `packages/ds/` is a workspace package with two files.
 */
const REPO: readonly FileRecord[] = [
  { file: 'vitest.config.ts', edges: [{ to: 'test/setup.ts', kind: 'imports' }] },
  { file: 'test/setup.ts', packages: [{ to: 'jest-environment-jsdom', kind: 'imports' }] },
  {
    file: 'src/Button.tsx',
    packages: [
      { to: 'react', kind: 'imports' },
      { to: '@mui/material', kind: 'type' },
    ],
  },
  { file: 'src/App.tsx', edges: [{ to: 'src/Button.tsx', kind: 'imports' }] },
  { file: 'packages/ds/src/index.ts', edges: [{ to: 'packages/ds/src/tokens.ts', kind: 'imports' }] },
  { file: 'packages/ds/src/tokens.ts' },
];

const RELATIONS = relationsOfFiles(REPO, { depends: [['jest-environment-jsdom', 'jsdom']] });

describe('a change beyond reach, read as files', () => {
  it('marks the file that imports a bumped package', () => {
    expect(beyondReach(RELATIONS, { packages: ['react'], moved: [] }).files).toEqual(['src/Button.tsx']);
  });

  it('stops at the first file, because the record answers for what imports it', () => {
    // `src/App.tsx` loads `react` only through `src/Button.tsx`, and every test
    // that entered `App` evaluated `Button` on the way.
    expect(beyondReach(RELATIONS, { packages: ['react'], moved: [] }).files).not.toContain('src/App.tsx');
  });

  it('traces a bump through the install to the file whose import rests on it', () => {
    // No file in the repository writes the word `jsdom`.
    expect(beyondReach(RELATIONS, { packages: ['jsdom'], moved: [] }).files).toEqual(['test/setup.ts']);
  });

  it('keeps the chain through the install that reached each file', () => {
    expect(beyondReach(RELATIONS, { packages: ['jsdom'], moved: [] }).chains.get('test/setup.ts')).toEqual([
      'jsdom',
      'jest-environment-jsdom',
    ]);
  });

  it('names the bumps that changed a file, and not the ones that changed none', () => {
    expect(beyondReach(RELATIONS, { packages: ['jsdom', '@mui/material', 'left-pad'], moved: [] }).traced).toEqual(['jsdom']);
  });

  it('does not follow a type-only import, which is erased before anything runs', () => {
    expect(beyondReach(RELATIONS, { packages: ['@mui/material'], moved: [] }).files).toEqual([]);
  });

  it('reaches nothing for a package no file imports', () => {
    expect(beyondReach(RELATIONS, { packages: ['left-pad'], moved: [] })).toEqual({ files: [], unplaced: [], traced: [], chains: new Map() });
  });

  it('reads a moved manifest as every file of its package', () => {
    expect(beyondReach(RELATIONS, { packages: [], moved: ['packages/ds/package.json'] }).files).toEqual([
      'packages/ds/src/index.ts',
      'packages/ds/src/tokens.ts',
    ]);
  });

  it('reads a moved manifest as the files under its own directory, not a sibling sharing its prefix', () => {
    const relations = relationsOfFiles([{ file: 'packages/ds/src/a.ts' }, { file: 'packages/dsx/src/b.ts' }, { file: 'src/c.ts' }]);

    expect(beyondReach(relations, { packages: [], moved: ['packages/ds/package.json'] }).files).toEqual(['packages/ds/src/a.ts']);
    expect(beyondReach(relations, { packages: [], moved: ['package.json'] }).files).toHaveLength(3);
  });

  it('hands back a moved manifest the graph holds no file beside, to be read as a changed path', () => {
    expect(beyondReach(RELATIONS, { packages: [], moved: ['tools/lint/package.json'] })).toEqual({
      files: [],
      unplaced: ['tools/lint/package.json'],
      traced: [],
      chains: new Map(),
    });
  });

  it('leaves no package for the stage after it', () => {
    // A bump of a package only the setup rests on arrives at before reach as the
    // setup file, and the closure there holds files alone.
    const before = beforeReach(RELATIONS, ['vitest.config.ts'], { sensed: ['src'] });
    const traced = beyondReach(RELATIONS, { packages: ['jsdom'], moved: [] });

    expect(changedBefore(before, traced.files)).toEqual(['test/setup.ts']);
  });
});
