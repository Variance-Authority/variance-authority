import { describe, expect, it } from 'vitest';
import { readingLines } from './index.js';

/**
 * The lines every selector prints about how it read each changed file. The
 * wording is asserted here once; the CLI and `yarn test:since` assert only that
 * they print it.
 */
describe('what a selector prints about each changed file', () => {
  const readings = [
    { file: 'src/limits.ts', verdict: 'values', names: ['LIMIT', 'STEP'], unseen: ['test/fill.test.js'] },
    { file: 'src/a.ts', unread: 'hunk' },
    { file: 'src/b.ts', unread: 'parse' },
  ] as const;

  it('says which bindings changed, why a file was not read, and names a test the graph does not explain', () => {
    expect(readingLines(readings)).toEqual([
      'read src/limits.ts: values — LIMIT, STEP changed; their readers and the changed regions are charged',
      'unseen test/fill.test.js: loaded src/limits.ts through an import the file graph does not list; named, not selected',
      'read src/a.ts: unread — the diff does not apply to the recorded text, so its changed lines are charged',
      'read src/b.ts: unread — one side does not parse, so its changed lines are charged',
    ]);
  });

  it('names the declared files behind a `load` verdict, and prints nothing for no readings', () => {
    expect(readingLines([{ file: 'src/wrap.ts', verdict: 'load', names: [], effects: ['src/polyfill.ts'] }])).toEqual([
      'read src/wrap.ts: load — the `sideEffects` field of its package declares src/polyfill.ts',
    ]);
    expect(readingLines([])).toEqual([]);
  });
});
