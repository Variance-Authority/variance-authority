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

  it('names every changed file no reader was asked of by why, each kind explained once', () => {
    // The notes beside these count each kind and say its remedy; the lines
    // name the files, and say what each kind costs on its first line.
    expect(
      readingLines([
        { file: 'src/read.ts', verdict: 'bodies', names: [] },
        { file: 'data/a.json', unread: 'nothing' },
        { file: 'data/b.json', unread: 'nothing' },
        { file: 'src/old.ts', unread: 'stale' },
        { file: 'src/far.ts', unread: 'declined' },
        { file: 'src/gen.ts', unread: 'ignored' },
        { file: 'src/rules.ts', unread: 'answered' },
      ]),
    ).toEqual([
      'read src/read.ts: bodies — the changed regions are charged, not the whole module',
      'read data/a.json: unread (the record and the file graph hold nothing about it) — it keeps no test in the run',
      'read data/b.json: unread (the record and the file graph hold nothing about it)',
      'read src/old.ts: unread (recorded from a text nobody kept) — every region of it is charged',
      'read src/far.ts: unread (the suite declines relations and its record did not measure it)',
      "read src/gen.ts: unread (the suite's `ignore` matches it) — only a test that declares it runs for it",
      'read src/rules.ts: unread (its rows, its preconditions or its importers answer for it)',
    ]);
  });
});
