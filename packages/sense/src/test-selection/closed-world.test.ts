import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { unreachedLoads } from './closed-world.js';

/**
 * `test/a.test.ts` imports `src/a.ts`, which imports `src/b.ts`, which imports
 * the package `ms`. `src/c.ts` is imported by nothing. Under `__mocks__` sit
 * what a runner serves for `src/b.ts` (it imports `src/fake.ts`), for
 * `src/c.ts`, and for the packages `ms` and `left-pad`. `test/setup.ts` runs
 * before every test and imports `src/clock.ts`.
 */
const FILES = [
  { file: 'test/a.test.ts', edges: [{ to: 'src/a.ts', kind: 'imports' as const }] },
  { file: 'src/a.ts', edges: [{ to: 'src/b.ts', kind: 'imports' as const }] },
  { file: 'src/b.ts', packages: [{ to: 'ms', kind: 'imports' as const }] },
  { file: 'src/c.ts' },
  { file: 'src/fake.ts' },
  { file: 'src/__mocks__/b.ts', edges: [{ to: 'src/fake.ts', kind: 'imports' as const }] },
  { file: 'src/__mocks__/c.ts' },
  { file: '__mocks__/ms.ts' },
  { file: '__mocks__/left-pad.ts' },
  { file: 'test/setup.ts', edges: [{ to: 'src/clock.ts', kind: 'imports' as const }] },
  { file: 'src/clock.ts' },
];
const RELATIONS = relationsOfFiles(FILES);

const loaded = (file: string, ...testFiles: string[]) => ({ file, blocks: [{ kind: 'module', testFiles }] });

describe('a load the import graph does not reach', () => {
  it('is nothing when every file a test loaded is one it imports, itself included', () => {
    const modules = [loaded('test/a.test.ts', 'test/a.test.ts'), loaded('src/a.ts', 'test/a.test.ts'), loaded('src/b.ts', 'test/a.test.ts')];
    expect(unreachedLoads(RELATIONS, modules, [])).toEqual([]);
  });

  it('names the file and the test when a test loaded a file no import of it reaches', () => {
    const modules = [loaded('src/a.ts', 'test/a.test.ts'), loaded('src/c.ts', 'test/a.test.ts')];
    expect(unreachedLoads(RELATIONS, modules, [])).toEqual([{ file: 'src/c.ts', test: 'test/a.test.ts' }]);
  });

  it('holds a file a before-file imports as reached by every test', () => {
    const modules = [loaded('src/clock.ts', 'test/a.test.ts')];
    expect(unreachedLoads(RELATIONS, modules, ['test/setup.ts'])).toEqual([]);
  });

  it('holds a mock as served when the test reaches the module it stands in for, and what the mock imports with it', () => {
    const modules = [loaded('src/__mocks__/b.ts', 'test/a.test.ts'), loaded('src/fake.ts', 'test/a.test.ts')];
    expect(unreachedLoads(RELATIONS, modules, [])).toEqual([]);
  });

  it('holds a mock under the root as served when the test reaches the package it stands in for', () => {
    const modules = [loaded('__mocks__/ms.ts', 'test/a.test.ts')];
    expect(unreachedLoads(RELATIONS, modules, [])).toEqual([]);
  });

  it('names a mock whose module no import of the test reaches, as it names any other file', () => {
    const modules = [loaded('src/__mocks__/c.ts', 'test/a.test.ts'), loaded('__mocks__/left-pad.ts', 'test/a.test.ts')];
    expect(unreachedLoads(RELATIONS, modules, [])).toEqual([
      { file: '__mocks__/left-pad.ts', test: 'test/a.test.ts' },
      { file: 'src/__mocks__/c.ts', test: 'test/a.test.ts' },
    ]);
  });

  it('holds a mock as served when the test asked for the module by mocking it, though the walk never enters it', () => {
    const shadowed = relationsOfFiles(FILES, { shadows: new Map([['test/a.test.ts', ['src/b.ts']]]) });
    const modules = [loaded('src/__mocks__/b.ts', 'test/a.test.ts'), loaded('src/b.ts', 'test/a.test.ts')];
    expect(unreachedLoads(shadowed, modules, [])).toEqual([{ file: 'src/b.ts', test: 'test/a.test.ts' }]);
  });

  it('walks a file the record holds under its built name from the source it was built from', () => {
    const modules = [loaded('dist/b.js', 'test/a.test.ts')];
    const sourceOf = (file: string) => (file === 'dist/b.js' ? 'src/b.ts' : file);
    expect(unreachedLoads(RELATIONS, modules, [], sourceOf)).toEqual([]);
  });

  it('reads only the module region, the one that says a test loaded the file', () => {
    const modules = [{ file: 'src/c.ts', blocks: [{ kind: 'function', testFiles: ['test/a.test.ts'] }] }];
    expect(unreachedLoads(RELATIONS, modules, [])).toEqual([]);
  });

  it.todo('fails the run that wrote the record when its suite declares `world: closed`, and reports the same rows when it declares `open` — needs the check run where a record is written, with the suite\'s `world` read from its config');
});
