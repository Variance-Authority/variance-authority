import { describe, expect, it } from 'vitest';
import { readingLines } from './index.js';

/**
 * The lines every selector prints about how it read each changed file. The
 * wording is asserted here once; the CLI asserts only that it prints it.
 */
describe('what a selector prints about each changed file', () => {
  const readings = [
    { file: 'src/limits.ts', verdict: 'values', names: ['LIMIT', 'STEP'], unseen: ['test/fill.test.js', 'test/drain.test.js'] },
    { file: 'src/a.ts', unread: 'hunk' },
    { file: 'src/b.ts', unread: 'parse' },
    { file: 'native/src/lib.rs', unread: 'language' },
    { file: 'src/twice.cjs', unread: 'exports' },
  ] as const;

  it('says which bindings changed, why a file was not read, and names a test the graph does not explain', () => {
    expect(readingLines(readings)).toEqual([
      'read src/limits.ts: values (LIMIT, STEP) — the readers of the changed values and the changed regions are charged',
      'unseen test/fill.test.js: loaded src/limits.ts by an import the file graph does not list; named, not selected',
      'unseen test/drain.test.js: loaded src/limits.ts',
      'read src/a.ts: unread (the diff does not apply to the recorded text) — its changed lines are charged',
      'read src/b.ts: unread (one side does not parse)',
      'read native/src/lib.rs: unread (not a JavaScript or TypeScript module)',
      'read src/twice.cjs: unread (it names no export to follow) — every test that loaded its nearest measured importers is charged',
    ]);
  });

  it('names the declared files behind a `load` verdict, and prints nothing for no readings', () => {
    expect(readingLines([{ file: 'src/wrap.ts', verdict: 'load', names: [], effects: ['src/polyfill.ts'] }])).toEqual([
      'read src/wrap.ts: load (`sideEffects` declares src/polyfill.ts) — every test that loaded it is charged',
    ]);
    expect(readingLines([])).toEqual([]);
  });

  it('tells a text the record was taken over apart from a runtime text the parser found equal', () => {
    // The record a run lays is taken over that run's text, and it still names
    // the tests carried from an earlier one. The line claims nothing about
    // them: the landing demoted each that ran an edited region, so it is not
    // skipped, and the line says that once rather than claim it ran this text.
    expect(
      readingLines([
        { file: 'src/kept.ts', verdict: 'none', names: [], kept: true },
        { file: 'src/equal.ts', verdict: 'none', names: [] },
        { file: 'src/again.ts', verdict: 'none', names: [], kept: true },
      ]),
    ).toEqual([
      'read src/kept.ts: none (the record was taken over this text) — a test recorded over an earlier text of an edited region is not skipped',
      'read src/equal.ts: none — the runtime text is equal',
      'read src/again.ts: none (the record was taken over this text)',
    ]);
  });

  it('names every changed file no reading names, each by why, however many there are', () => {
    // The notes beside these count the files, explain what each kind costs,
    // and cut the list at three; this is where the fourth is named, by its
    // status alone, so nothing is explained twice.
    expect(
      readingLines([{ file: 'src/read.ts', verdict: 'bodies', names: [] }], {
        unread: ['data/a.json', 'data/b.json', 'data/c.json', 'data/d.json'],
        stale: ['src/old.ts'],
        declined: ['src/far.ts'],
        ignored: ['src/gen.ts'],
        unasked: ['src/rules.ts'],
      }),
    ).toEqual([
      'read src/read.ts: bodies — the changed regions are charged, not the whole module',
      'read data/a.json: unread',
      'read data/b.json: unread',
      'read data/c.json: unread',
      'read data/d.json: unread',
      'read src/old.ts: stale',
      'read src/far.ts: declined',
      'read src/gen.ts: ignored',
      'read src/rules.ts: unasked — its rows, its preconditions or its importers answer for it',
    ]);
  });

  it('names a file a reading already names once', () => {
    expect(readingLines([{ file: 'src/old.ts', unread: 'source' }], { stale: ['src/old.ts'] })).toEqual([
      'read src/old.ts: unread (no recorded text to read it against) — its changed lines are charged',
    ]);
  });
});
