import { describe, expect, it } from 'vitest';
import journalFormat from './journal-format.cjs';
import { runCrossings } from './run-crossings.js';
import type { ReadJournal } from './instrumented-modules.js';

const root = '/r';

describe('the crossings of a run', () => {
  const pages: readonly ReadJournal[] = [
    { testFile: '/r/test/beta.case.ts', modules: [{ id: 'src/cart.js', hits: [0, 3], shared: [0], loaded: [0] }] },
    { testFile: '/r/test/alpha.case.ts', modules: [{ id: 'src/cart.js', hits: [0, 1, 2], shared: [0, 1], loaded: [0, 1] }] },
    { testFile: '/r/test/gamma.case.ts', modules: [] },
  ];
  const crossings = runCrossings([], pages, root, new Map(), ['src/cart.js']);
  const ordinals = (of: (id: string, ordinal: number) => readonly string[]) =>
    [0, 1, 2, 3].map((ordinal) => of('src/cart.js', ordinal));

  it('credits what a module did while evaluating to every file that consumed it, and names them in code-unit order', () => {
    expect(ordinals(crossings.observed)).toEqual([
      ['test/alpha.case.ts', 'test/beta.case.ts'],
      ['test/alpha.case.ts', 'test/beta.case.ts'],
      ['test/alpha.case.ts'],
      ['test/beta.case.ts'],
    ]);
  });

  it('folds what ran before the first test under the same crediting', () => {
    // Ordinal 1 ran while the module evaluated, and evaluation happened before
    // the first test of every file that consumed it — beta included, whose own
    // snapshot never saw it because alpha's window evaluated the module.
    expect(ordinals(crossings.early)).toEqual([
      ['test/alpha.case.ts', 'test/beta.case.ts'],
      ['test/alpha.case.ts', 'test/beta.case.ts'],
      [],
      [],
    ]);
  });

  it('names nobody for a module or an ordinal no file crossed', () => {
    expect(crossings.observed('src/other.js', 0)).toEqual([]);
    expect(crossings.observed('src/cart.js', 9)).toEqual([]);
  });

  it('gives each file its journals, by its project path, and the modules each entered', () => {
    expect(crossings.journalsOf('test/alpha.case.ts').map((journal) => [journal.index, [...journal.modules]])).toEqual([[1, [0]]]);
    expect(crossings.journalsOf('test/gamma.case.ts').map((journal) => [...journal.modules])).toEqual([[]]);
    expect(crossings.journalsOf('test/delta.case.ts')).toEqual([]);
  });

  it('leaves out a module the run could not place, and says which journal named it', () => {
    const partial = runCrossings([], pages, root, new Map(), []);
    expect(partial.ids).toEqual([]);
    expect(partial.journals.map((journal) => [journal.test, journal.placed])).toEqual([
      ['test/beta.case.ts', false],
      ['test/alpha.case.ts', false],
      ['test/gamma.case.ts', true],
    ]);
  });

  it('reads the workers\' journals before the pages\', with when each finished collecting', () => {
    const frame = Buffer.from(journalFormat.encodeJournal('/r/test/worker.case.ts', new Map([['src/cart.js', new Uint32Array([1])]]), undefined, 1_700_000_000_000));
    const both = runCrossings([frame], pages.slice(0, 1), root, new Map(), ['src/cart.js']);
    expect(both.journals.map((journal) => [journal.test, journal.collected])).toEqual([
      ['test/worker.case.ts', 1_700_000_000_000],
      ['test/beta.case.ts', undefined],
    ]);
    expect(both.observed('src/cart.js', 0)).toEqual(['test/beta.case.ts', 'test/worker.case.ts']);
  });
});
