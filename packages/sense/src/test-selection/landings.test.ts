import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { commitRunsAfter, type CommitRuns, type RecordedTests } from './commit-runs.js';
import type { Landing } from './landings.js';
import { testPlaces } from './test-places.js';

const DAY1 = '2026-01-01T00:00:00.000Z';
const DAY2 = '2026-01-02T00:00:00.000Z';
const DAY3 = '2026-01-03T00:00:00.000Z';

/** The snapshot a run is laid over: these test files at `commit`. */
function snapshot(commit: string, ...files: string[]): RecordedTests {
  return { instrumentation: 'fixture', commit, tests: files.map((file) => ({ file })) };
}

/** A run at `commit`: each file finished unless it is named in `partly`. */
function ran(commit: string, files: readonly string[], partly: readonly string[] = []) {
  return {
    instrumentation: 'fixture',
    commit,
    tests: [...files.map((file) => ({ file, complete: true })), ...partly.map((file) => ({ file, complete: false }))],
  };
}

/** A run at `commit` that kept its cases: each finished file by one case, each file in `partly` by the cases it executed of it. */
function ranCases(commit: string, files: readonly string[], partly: Readonly<Record<string, readonly string[]>>) {
  return {
    ...ran(commit, files, Object.keys(partly)),
    executed: new Map<string, readonly string[]>([...files.map((file) => [file, [`${file} case`]] as const), ...Object.entries(partly)]),
  };
}

/** The record one run at `commit` left at `at`: its one landing finished `files`, over the commit's texts unless `kept` says otherwise. */
function record(commit: string, at: string, files: readonly string[], kept: Pick<Landing, 'installed' | 'texts'> = { texts: {} }): CommitRuns {
  return {
    commit, first: at, latest: at, runs: 1, files,
    ...(kept.installed === undefined ? {} : { installed: kept.installed }),
    landings: [{ files, first: at, latest: at, runs: 1, ...kept }],
  };
}

/** `commitRunsAfter`, landing at `at`. */
function landAt(at: string, ...args: Parameters<typeof commitRunsAfter>): CommitRuns {
  vi.setSystemTime(new Date(at));
  return commitRunsAfter(...args);
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('a run observes the test files it finished', () => {
  it('leaves a file a run at another commit ran only in part where it stood, with its time and text', () => {
    // `-t` lists every test file and finishes the one it matched in whole.
    const held = record('P', DAY1, ['a.test.ts', 'b.test.ts']);
    const after = landAt(DAY2, snapshot('P', 'a.test.ts', 'b.test.ts'), held, ran('R', ['a.test.ts'], ['b.test.ts']), {}, { 'src/m.ts': 'dirty' });

    expect(after.files).toEqual(['a.test.ts']);
    expect(after.standing).toEqual([{ commit: 'P', files: ['b.test.ts'], first: DAY1, latest: DAY1, runs: 1, texts: {} }]);
    expect(after.landings).toEqual([
      { files: ['a.test.ts'], partly: ['b.test.ts'], first: DAY2, latest: DAY2, runs: 1, installed: {}, texts: { 'src/m.ts': 'dirty' } },
    ]);
  });

  it('observes a file the snapshot did not hold even when it ran in part: every case it has is this run\'s', () => {
    const held = record('P', DAY1, ['a.test.ts']);
    const after = landAt(DAY2, snapshot('P', 'a.test.ts'), held, ran('R', ['a.test.ts'], ['n.test.ts']), undefined, {});

    expect(after.files).toEqual(['a.test.ts', 'n.test.ts']);
    expect(after.landings).toEqual([{ files: ['a.test.ts', 'n.test.ts'], first: DAY2, latest: DAY2, runs: 1, texts: {} }]);
  });

  it('keeps the text of the files a run at the same commit did not finish, and knows no single text for the record', () => {
    const held: CommitRuns = { ...record('P', DAY1, ['a.test.ts', 'b.test.ts'], { installed: {}, texts: {} }), over: 'O' };
    const after = landAt(DAY2, snapshot('P', 'a.test.ts', 'b.test.ts'), held, ran('P', ['b.test.ts'], ['a.test.ts']), {}, { 'src/m.ts': 'dirty' });

    expect(after).toMatchObject({ commit: 'P', over: 'O', first: DAY1, latest: DAY2, runs: 2, files: ['a.test.ts', 'b.test.ts'], installed: {} });
    expect(after).not.toHaveProperty('texts');
    expect(after.landings).toEqual([
      { files: ['a.test.ts'], first: DAY1, latest: DAY1, runs: 1, installed: {}, texts: {} },
      { files: ['b.test.ts'], partly: ['a.test.ts'], first: DAY2, latest: DAY2, runs: 1, installed: {}, texts: { 'src/m.ts': 'dirty' } },
    ]);
  });

  it('drops a landing every file of which a later run at the commit finished again, and the part runs it finished', () => {
    const first = landAt(DAY1, snapshot('O', 'a.test.ts', 'b.test.ts'), undefined, ran('P', ['a.test.ts', 'b.test.ts']), {}, {});
    const second = landAt(DAY2, snapshot('P', 'a.test.ts', 'b.test.ts'), first, ran('P', ['b.test.ts'], ['a.test.ts']), {}, { 'src/m.ts': 'dirty' });
    const third = landAt(DAY3, snapshot('P', 'a.test.ts', 'b.test.ts'), second, ran('P', ['a.test.ts', 'b.test.ts']), {}, {});

    // The texts are each landing's: the record names none of its own.
    expect(third.landings).toEqual([{ files: ['a.test.ts', 'b.test.ts'], first: DAY3, latest: DAY3, runs: 1, installed: {}, texts: {} }]);
    expect(third).not.toHaveProperty('texts');
  });
});

describe('a run observes the cases it executed', () => {
  it('does not observe a file the snapshot held that it executed no case of, which stays where it stood', () => {
    // `-t` matched no case of b.test.ts: the runner collected it and skipped every case.
    const held = record('P', DAY1, ['a.test.ts', 'b.test.ts']);
    const after = landAt(DAY2, snapshot('P', 'a.test.ts', 'b.test.ts'), held, ranCases('R', ['a.test.ts'], { 'b.test.ts': [] }), {}, {});

    expect(after.landings).toEqual([{ files: ['a.test.ts'], first: DAY2, latest: DAY2, runs: 1, installed: {}, texts: {} }]);
    expect(after.standing).toEqual([{ commit: 'P', files: ['b.test.ts'], first: DAY1, latest: DAY1, runs: 1, texts: {} }]);
  });

  it('names the cases it executed of each file it ran in part, and they travel with its landing into its stand', () => {
    const held = record('P', DAY1, ['a.test.ts', 'b.test.ts']);
    const two = landAt(DAY2, snapshot('P', 'a.test.ts', 'b.test.ts'), held, ranCases('R', ['a.test.ts'], { 'b.test.ts': ['refunds'] }), {}, {});

    expect(two.landings).toEqual([
      { files: ['a.test.ts'], partly: ['b.test.ts'], cases: { 'b.test.ts': ['refunds'] }, first: DAY2, latest: DAY2, runs: 1, installed: {}, texts: {} },
    ]);
    const three = landAt(DAY3, snapshot('R', 'a.test.ts', 'b.test.ts'), two, ranCases('S', ['a.test.ts'], {}), {}, {});
    expect(three.standing).toContainEqual(
      { commit: 'R', files: [], partly: ['b.test.ts'], cases: { 'b.test.ts': ['refunds'] }, first: DAY2, latest: DAY2, runs: 1, installed: {}, texts: {} },
    );
    const { places } = testPlaces({ commit: 'S', runs: three, tests: ['b.test.ts'] });
    expect(places.get('b.test.ts')?.partly).toEqual([{ commit: 'R', first: DAY2, latest: DAY2, runs: 1, texts: {}, cases: { 'b.test.ts': ['refunds'] } }]);
  });
});

describe('each run is its own landing', () => {
  it('moves each landing at a commit into its own stand, with its own time and texts, when a run at another commit lands', () => {
    const one = landAt(DAY1, snapshot('O', 'a.test.ts', 'b.test.ts', 'c.test.ts'), undefined, ran('P', ['a.test.ts', 'b.test.ts', 'c.test.ts']), {}, { 'src/m.ts': 'one' });
    const two = landAt(DAY2, snapshot('P', 'a.test.ts', 'b.test.ts', 'c.test.ts'), one, ran('P', ['b.test.ts']), {}, { 'src/m.ts': 'two' });
    const three = landAt(DAY3, snapshot('P', 'a.test.ts', 'b.test.ts', 'c.test.ts'), two, ran('R', ['c.test.ts']), {}, {});

    expect(three.standing).toEqual([
      { commit: 'P', files: ['a.test.ts'], first: DAY1, latest: DAY1, runs: 1, installed: {}, texts: { 'src/m.ts': 'one' } },
      { commit: 'P', files: ['b.test.ts'], first: DAY2, latest: DAY2, runs: 1, installed: {}, texts: { 'src/m.ts': 'two' } },
    ]);
  });

  it('places each test file by the run that last finished it, and names the later runs that ran it in part', () => {
    const one = landAt(DAY1, snapshot('O', 'a.test.ts', 'b.test.ts'), undefined, ran('P', ['a.test.ts', 'b.test.ts']), {}, { 'src/m.ts': 'one' });
    const two = landAt(DAY2, snapshot('P', 'a.test.ts', 'b.test.ts'), one, ran('P', ['b.test.ts'], ['a.test.ts']), {}, { 'src/m.ts': 'two' });
    const { places } = testPlaces({ commit: 'P', runs: two, tests: ['a.test.ts', 'b.test.ts'] });

    expect(places.get('a.test.ts')).toEqual({
      commit: 'P', first: DAY1, latest: DAY1, runs: 1, texts: { 'src/m.ts': 'one' },
      partly: [{ commit: 'P', first: DAY2, latest: DAY2, runs: 1, texts: { 'src/m.ts': 'two' } }],
    });
    expect(places.get('b.test.ts')).toEqual({ commit: 'P', first: DAY2, latest: DAY2, runs: 1, texts: { 'src/m.ts': 'two' } });
  });

  it('carries a stand that ran a file in part into the next record, until a run finishes the file', () => {
    const held = record('P', DAY1, ['a.test.ts', 'b.test.ts']);
    const two = landAt(DAY2, snapshot('P', 'a.test.ts', 'b.test.ts'), held, ran('R', ['a.test.ts'], ['b.test.ts']), undefined, {});
    const three = landAt(DAY3, snapshot('R', 'a.test.ts', 'b.test.ts'), two, ran('S', ['a.test.ts']), undefined, {});

    expect(three.standing).toEqual([
      { commit: 'P', files: ['b.test.ts'], first: DAY1, latest: DAY1, runs: 1, texts: {} },
      { commit: 'R', files: [], partly: ['b.test.ts'], first: DAY2, latest: DAY2, runs: 1, texts: {} },
    ]);
    const { places } = testPlaces({ commit: 'S', runs: three, tests: ['b.test.ts'] });
    expect(places.get('b.test.ts')?.partly).toEqual([{ commit: 'R', first: DAY2, latest: DAY2, runs: 1, texts: {} }]);

    const four = landAt(DAY3, snapshot('S', 'a.test.ts', 'b.test.ts'), three, ran('T', ['b.test.ts']), undefined, {});
    expect(four.standing).toEqual([{ commit: 'S', files: ['a.test.ts'], first: DAY3, latest: DAY3, runs: 1, texts: {} }]);
  });

  it('carries the landings of earlier runs outside a checkout, which all stand at one place', () => {
    const outside = (files: readonly string[], partly: readonly string[] = []) => {
      const { commit: _commit, ...run } = ran('', files, partly);
      return run;
    };
    const one = landAt(DAY1, undefined, undefined, outside(['a.test.ts', 'b.test.ts']), {}, {});
    const two = landAt(DAY2, { instrumentation: 'fixture', tests: [{ file: 'a.test.ts' }, { file: 'b.test.ts' }] }, one, outside(['b.test.ts'], ['a.test.ts']), {}, {});

    expect(two).toMatchObject({ first: DAY1, latest: DAY2, runs: 2, files: ['a.test.ts', 'b.test.ts'] });
    expect(two.landings).toEqual([
      { files: ['a.test.ts'], first: DAY1, latest: DAY1, runs: 1, installed: {}, texts: {} },
      { files: ['b.test.ts'], partly: ['a.test.ts'], first: DAY2, latest: DAY2, runs: 1, installed: {}, texts: {} },
    ]);
    const { places } = testPlaces({ commit: undefined, runs: two, tests: ['a.test.ts'] });
    expect(places.get('a.test.ts')).toEqual({ first: DAY1, latest: DAY1, runs: 1, texts: {}, partly: [{ first: DAY2, latest: DAY2, runs: 1, texts: {} }] });
  });

  it('reads a record written before landings as one landing of its envelope, which names no texts', () => {
    const held: CommitRuns = { commit: 'P', first: DAY1, latest: DAY2, runs: 2, files: ['a.test.ts'], installed: {} };
    const { places } = testPlaces({ commit: 'P', runs: held, tests: ['a.test.ts'] });

    expect(places.get('a.test.ts')).toEqual({ commit: 'P', first: DAY1, latest: DAY2, runs: 2 });
  });
});
