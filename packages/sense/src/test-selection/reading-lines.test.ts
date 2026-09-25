import { describe, expect, it } from 'vitest';
import { readingLines } from './index.js';

/**
 * The lines every selector prints about how it read each changed file. The
 * wording is asserted here once; the CLI and `yarn test:since` assert only that
 * they print it.
 */
describe('what a selector prints about each changed file', () => {
  const readings = [
    { file: 'src/limits.ts', verdict: 'values', names: ['LIMIT', 'STEP'], unseen: ['test/fill.test.js', 'test/drain.test.js'] },
    { file: 'src/a.ts', unread: 'hunk' },
    { file: 'src/b.ts', unread: 'parse' },
    { file: 'native/src/lib.rs', unread: 'language' },
  ] as const;

  it('says which bindings changed, why a file was not read, and names a test the graph does not explain', () => {
    expect(readingLines(readings)).toEqual([
      'read src/limits.ts: values (LIMIT, STEP) — the readers of the changed values and the changed regions are charged',
      'unseen test/fill.test.js: loaded src/limits.ts by an import the file graph does not list; named, not selected',
      'unseen test/drain.test.js: loaded src/limits.ts',
      'read src/a.ts: unread (the diff does not apply to the recorded text) — its changed lines are charged',
      'read src/b.ts: unread (one side does not parse)',
      'read native/src/lib.rs: unread (not a JavaScript or TypeScript module)',
    ]);
  });

  it('names the declared files behind a `load` verdict, and prints nothing for no readings', () => {
    expect(readingLines([{ file: 'src/wrap.ts', verdict: 'load', names: [], effects: ['src/polyfill.ts'] }])).toEqual([
      'read src/wrap.ts: load (`sideEffects` declares src/polyfill.ts) — every test that loaded it is charged',
    ]);
    expect(readingLines([])).toEqual([]);
  });
});
