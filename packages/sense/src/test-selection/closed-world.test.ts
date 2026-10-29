import { relationsOfFiles } from '@variance-authority/core/relate';
import { describe, expect, it } from 'vitest';
import { unreachedLoads } from './closed-world.js';

/**
 * `test/a.test.ts` imports `src/a.ts`, which imports `src/b.ts`. `src/c.ts` is
 * imported by nothing; `src/__mocks__/b.ts` is what a runner serves for `src/b.ts`.
 * `test/setup.ts` runs before every test and imports `src/clock.ts`.
 */
const RELATIONS = relationsOfFiles([
  { file: 'test/a.test.ts', edges: [{ to: 'src/a.ts', kind: 'imports' }] },
  { file: 'src/a.ts', edges: [{ to: 'src/b.ts', kind: 'imports' }] },
  { file: 'src/b.ts' },
  { file: 'src/c.ts' },
  { file: 'src/__mocks__/b.ts' },
  { file: 'test/setup.ts', edges: [{ to: 'src/clock.ts', kind: 'imports' }] },
  { file: 'src/clock.ts' },
]);

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

  it('holds a file under __mocks__ as the mock the runner served, not a breach', () => {
    const modules = [loaded('src/__mocks__/b.ts', 'test/a.test.ts')];
    expect(unreachedLoads(RELATIONS, modules, [])).toEqual([]);
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
