/**
 * The histories a record must be carried through, each told end to end and
 * asked its last selection by a reader the caller names: in-process, or the
 * CLI in a process of its own that opens the record cold.
 *
 * Every expectation is written from the labels the fixture's tests hit, never
 * read back from the code under test, and every selection is compared whole,
 * so a test missing from it and a test selected for nothing both fail.
 */

import { expect } from 'vitest';
import { keepRecord, type Compare } from './carry-comparison.js';
import { commit, held, noted, runElsewhere, runTests, selected, touching, walking, type Walk } from './carry-contract.js';

export const A = 'test/a.test.ts';
export const B = 'test/b.test.ts';
export const C = 'test/c.test.ts';

/** A reader of the selection for the change from HEAD to `next`. */
export type Ask = (walk: Walk, next: string) => Promise<readonly string[]>;

/** A component that gives `useEffect` two callbacks; `note` is a comment written inside the second. */
export const effects = (options: { readonly note?: boolean } = {}): string => [
  "hit('top');",
  'export function component(a: number, b: number) {',
  "  hit('outer');",
  '  useEffect(() => {',
  "    hit('first');",
  '  }, [a]);',
  '  useEffect(() => {',
  ...(options.note === true ? ['    // the second effect runs after the first'] : []),
  "    hit('second');",
  '  }, [b]);',
  '}',
  '',
].join('\n');

/** A function whose body branches twice; `one: false` deletes the first branch. */
export const branches = (options: { readonly one?: boolean; readonly top?: string } = {}): string => [
  "hit('top');",
  ...(options.top === undefined ? [] : [options.top]),
  'export function f(x: number) {',
  "  hit('body');",
  ...(options.one === false ? [] : ['  if (x === 1) {', "    hit('one');", '  }']),
  '  if (x === 2) {',
  "    hit('two');",
  '  }',
  '}',
  '',
].join('\n');

/** Asserts `actual` equals `expected`, noting both in the walk's artifacts. */
function check<T>(walk: Walk, name: string, actual: T, expected: T): void {
  expect(noted(walk, name, actual, expected), name).toEqual(expected);
}

/**
 * A full recording, a comment that selects nothing, a run of other tests that
 * carries the subject's record to the commented text, and an edit inside each
 * effect, selected by the test that ran it alone.
 */
export async function commentThenRunElsewhere(ask: Ask): Promise<void> {
  await walking(effects(), { [A]: ['top', 'outer', 'first'], [B]: ['top', 'outer', 'second'] }, async (walk) => {
    await runTests(walk, [A, B]);
    const recorded = { top: [A, B], outer: [A, B], first: [A], second: [B] };
    check(walk, 'recorded', await held(walk), { cases: recorded, rows: recorded, loadedBy: [A, B] });

    check(walk, 'a comment', await selected(walk, effects({ note: true })), []);
    await commit(walk, effects({ note: true }), 'a comment');
    await runElsewhere(walk);

    // Every region ran as it did, and keeps what entered it at the lines it stands at now.
    check(walk, 'carried', await held(walk), { cases: recorded, rows: recorded, loadedBy: [A, B] });
    check(walk, 'an edit in the first effect', await ask(walk, touching(walk.text, 'first')), [A]);
    check(walk, 'an edit in the second effect', await ask(walk, touching(walk.text, 'second')), [B]);
  });
}

/**
 * A cut that lacks the first of two callbacks given to `useEffect`, a comment
 * inside the second, and a run of other tests.
 *
 * Known after the first run: top and `outer` were entered by A and B, the
 * second callback by B. The first callback is unknown: A's entry into it stands
 * on `outer`. The newer cut holds both callbacks, and the two cuts hold the
 * address `component/useEffect.arg0` a different number of times, so no
 * occurrence identifies either: each inherits `outer`'s cases, a superset. An
 * edit inside the first selects A, which ran it, and B only by inheritance.
 */
export async function lackedCallbackThenComment(ask: Ask): Promise<void> {
  await walking(effects(), { [A]: ['top', 'outer', 'first'], [B]: ['top', 'outer', 'second'] }, async (walk) => {
    await runTests(walk, [A, B], { lacks: ['first'] });
    check(walk, 'recorded', (await held(walk)).cases, { top: [A, B], outer: [A, B], second: [B] });

    await commit(walk, effects({ note: true }), 'a comment inside the second effect');
    await runElsewhere(walk);

    const inherited = { top: [A, B], outer: [A, B], first: [A, B], second: [A, B] };
    const after = await held(walk);
    check(walk, 'carried cases', after.cases, inherited);
    check(walk, 'carried rows', after.rows, inherited);
    check(walk, 'an edit in the first effect', await ask(walk, touching(walk.text, 'first')), [A, B]);
    check(walk, 'an edit in the second effect', await ask(walk, touching(walk.text, 'second')), [A, B]);
  });
}

/**
 * A branch deleted from a function's body, which renumbers the branch after it
 * and moves every span below, and a run of the tests that edit selected.
 *
 * C only loads the module. The edit changes `f`'s body and nothing the module
 * does as it loads, so the module's region keeps C's case and its load
 * evidence; a later edit at load selects every test that loaded it.
 */
export async function branchDeletedThenRun(ask: Ask): Promise<void> {
  await walking(branches(), { [A]: ['top', 'body', 'one'], [B]: ['top', 'body', 'two'], [C]: ['top'] }, async (walk) => {
    await runTests(walk, [A, B, C]);

    // The deleted lines open a branch, so the function around it is charged too.
    const deleted = branches({ one: false });
    check(walk, 'a deleted branch', await selected(walk, deleted), [A, B]);
    await commit(walk, deleted, 'the first branch deleted');
    await runTests(walk, [A, B]);

    const after = await held(walk);
    check(walk, 'after the run', after, {
      cases: { top: [A, B, C], body: [A, B], two: [B] },
      rows: { top: [A, B, C], body: [A, B], two: [B] },
      loadedBy: [A, B, C],
    });
    check(walk, 'an edit at load', await ask(walk, branches({ one: false, top: "hit('again');" })), [A, B, C]);
    check(walk, 'an edit in the surviving branch', await ask(walk, touching(walk.text, 'two')), [B]);
  });
}

/**
 * {@link branchDeletedThenRun} with the run landing other tests only: the
 * subject's record is carried through the deletion rather than re-recorded,
 * and the module's region still keeps every case and its load evidence.
 */
export async function branchDeletedThenRunElsewhere(ask: Ask): Promise<void> {
  await walking(branches(), { [A]: ['top', 'body', 'one'], [B]: ['top', 'body', 'two'], [C]: ['top'] }, async (walk) => {
    await runTests(walk, [A, B, C]);
    await commit(walk, branches({ one: false }), 'the first branch deleted');
    await runElsewhere(walk);

    const after = await held(walk);
    check(walk, 'top cases', after.cases.top, [A, B, C]);
    check(walk, 'top rows', after.rows.top, [A, B, C]);
    check(walk, 'load', after.loadedBy, [A, B, C]);
    check(walk, 'an edit at load', await ask(walk, branches({ one: false, top: "hit('again');" })), [A, B, C]);
  });
}

/**
 * An import written at the top of the subject, which changes what it does as
 * it loads, and a run of other tests that carries the subject's record over it.
 *
 * A and B last ran before the edit. The edit's reading reaches the top level,
 * so the carried record holds none of their cases there: whether they still
 * run it was not measured. The comparison with the record before the edit
 * says so, and never that either no longer runs it. Their functions' bodies
 * did not change, and keep their cases.
 */
export async function importEditedThenRunElsewhere(compare: Compare): Promise<void> {
  await walking(branches(), { [A]: ['top', 'body', 'one'], [B]: ['top', 'body', 'two'] }, async (walk) => {
    await runTests(walk, [A, B]);
    const base = await keepRecord(walk, 'before the import');
    await commit(walk, branches({ top: "import { elsewhere } from './elsewhere';" }), 'an import at the top');
    await runElsewhere(walk);

    check(walk, 'the comparison', await compare(walk, base), { lost: 0, unmeasured: 1, left: {} });
  });
}
