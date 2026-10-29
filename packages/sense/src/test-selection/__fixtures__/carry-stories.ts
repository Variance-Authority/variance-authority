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
import { caseSectionsAt } from '../case-record.js';
import { keepRecord, type Compare } from './carry-comparison.js';
import { caseOf, commit, flagged, held, noted, owed, runElsewhere, runTests, selected, touching, walking, type Walk } from './carry-contract.js';
import type { Ran, Stood } from './carry-ran.js';

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
    check(walk, 'owed after the comment', await owed(walk), []);
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
 * A type written at the top of the subject, which changes its text and nothing
 * it does, and a run of other tests that carries the subject's record over it.
 *
 * The edit moves every span below it, and the top level's text changed, but
 * nothing that runs did: every region keeps every case and the load evidence,
 * and an edit at load selects every test that loaded the module.
 */
export async function typeWrittenThenRunElsewhere(ask: Ask): Promise<void> {
  await walking(branches(), { [A]: ['top', 'body', 'one'], [B]: ['top', 'body', 'two'], [C]: ['top'] }, async (walk) => {
    await runTests(walk, [A, B, C]);
    // B alone ran the statements after the first branch, a region no label names, at 7-9.
    const recorded = { top: [A, B, C], body: [A, B], one: [A], two: [B] };
    check(walk, 'recorded', await held(walk), {
      cases: { ...recorded, 'continuation@7-9': [B] },
      rows: { ...recorded, 'continuation@7-9': [B] },
      loadedBy: [A, B, C],
    });

    const typed = branches({ top: 'type Unused = number;' });
    check(walk, 'a type', await selected(walk, typed), []);
    await commit(walk, typed, 'a type at the top');
    await runElsewhere(walk);

    // The same, one line lower.
    check(walk, 'carried', await held(walk), {
      cases: { ...recorded, 'continuation@8-10': [B] },
      rows: { ...recorded, 'continuation@8-10': [B] },
      loadedBy: [A, B, C],
    });
    // The top level's text changed, and nothing it does: no test is owed a run.
    check(walk, 'owed after the type', await owed(walk), []);
    check(walk, 'an edit at load', await ask(walk, branches({ top: "type Unused = number;\nhit('again');" })), [A, B, C]);
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

    // The import reached the top level both entered, so both are owed a run.
    check(walk, 'owed after the import', await owed(walk), [A, B]);
    check(walk, 'the comparison', await compare(walk, base), { lost: 0, unmeasured: 1, left: {} });
  });
}

/** A later partial run names its own cases after a carried edit changes the index's row numbering. */
export async function lastRunAfterCarry(ask: Ask, scope: (walk: Walk) => Promise<readonly string[]>): Promise<void> {
  // Defer the reader so the fault-injection harness installs its edit-reading mock before the landing loads.
  const { lastCaseRunOf } = await import('../case-landing.js');
  await walking(effects(), { [A]: ['top', 'outer', 'first'], [B]: ['top', 'outer', 'second'] }, async (walk) => {
    await runTests(walk, [B, A]);
    const first = caseSectionsAt(walk.coverageFile);
    check(walk, 'compact last-run membership', Array.isArray(JSON.parse(Buffer.from(first.last!).toString()).cases), false);
    const before = walk.head;
    await commit(walk, effects({ note: true }), 'a comment before a partial run');
    await runElsewhere(walk);
    await runTests(walk, [A]);
    check(walk, 'the before commit survives the carry', lastCaseRunOf(caseSectionsAt(walk.coverageFile))?.before, before);
    check(walk, 'the first effect still selects only its observer', await ask(walk, touching(walk.text, 'first')), [A]);
    check(walk, 'the carried effect keeps its observer', await ask(walk, touching(walk.text, 'second')), [B]);
    check(walk, 'only the last run owns the scope', await scope(walk), [caseOf(A)]);
  });
}

/**
 * A run of one test over an uncommitted edit inside a region both tests
 * entered, and the same change asked before and after the texts landings kept
 * are forgotten.
 *
 * A ran over the edited text. B last ran the earlier text of `outer`, carried
 * onto the edit, so the landing owes it a run. While the edited text is kept,
 * the rows A's run cut are read from it, and the change from HEAD to it is
 * one A already ran: nothing is selected, and B is owed. Once it is
 * forgotten, nothing proves which text the rows were cut from, so the change
 * charges every test that loaded the module, and B is still owed.
 */
export async function ranOverThenKeptForgotten(ask: Ask, forget: (walk: Walk) => Promise<void>): Promise<void> {
  await walking(effects(), { [A]: ['top', 'outer', 'first'], [B]: ['top', 'outer', 'second'] }, async (walk) => {
    await runTests(walk, [A, B]);
    const edited = touching(walk.text, 'outer');
    await runTests(walk, [A], { over: edited });

    check(walk, 'owed, its text kept', await owed(walk), [B]);
    check(walk, 'the edit, its text kept', await ask(walk, edited), []);
    await forget(walk);
    check(walk, 'owed, no text kept', await owed(walk), [B]);
    check(walk, 'the edit, no text kept', await ask(walk, edited), [A, B]);
  });
}

/**
 * A run of one test over an uncommitted edit inside the region only the other
 * test entered, asked of the tree as that run left it and of edits to it.
 *
 * The landing lays the record in the edited text, where the edit wrote over
 * the second effect and the function around it: B ran them in another text,
 * so whether B runs these is not known. The record names A alone on the
 * function, which A ran in the edited text, no case on the second effect, and
 * keeps B on both flagged and owed a run, so no reader takes B's absence as
 * evidence: an ambiguous correspondence never becomes measured absence. The
 * module's region holds both, since the edit wrote no line of it. The tree is
 * asked as a pipeline asks it, from the text the record was laid in: that
 * text itself changes nothing, and an edit to the second effect or the
 * function selects B.
 */
export async function ranOverAnotherTestsRegion(ask: Ask): Promise<void> {
  await walking(effects(), { [A]: ['top', 'outer', 'first'], [B]: ['top', 'outer', 'second'] }, async (walk) => {
    await runTests(walk, [A, B]);
    const over = touching(walk.text, 'second');
    await runTests(walk, [A], { over });

    check(walk, 'the cases that ran each region', (await held(walk)).cases, { top: [A, B], outer: [A], first: [A], second: [] });
    check(walk, 'the cases not known to have run it', await flagged(walk), { outer: [B], second: [B] });
    check(walk, 'owed', await owed(walk), [B]);
    check(walk, 'the text A ran over', await ask(walk, over), []);
    check(walk, 'an edit in the second effect', await ask(walk, touching(over, 'second')), [B]);
    check(walk, 'an edit in the first effect', await ask(walk, touching(over, 'first')), [A]);
    check(walk, 'an edit in the function', await ask(walk, touching(over, 'outer')), [A, B]);
  });
}

/**
 * A run of both tests over an uncommitted edit inside a region both entered,
 * and the texts landings kept forgotten.
 *
 * Both ran the edit, so neither is owed a run. The rows carry the edited
 * text's digest, but with no text kept the digest alone does not say the
 * landing that cut them demoted what it carried, so it cannot stand in for the
 * text: the change to the edit charges every test that loaded the module.
 */
export async function bothRanOverAnUnkeptEdit(ask: Ask, forget: (walk: Walk) => Promise<void>): Promise<void> {
  await walking(effects(), { [A]: ['top', 'outer', 'first'], [B]: ['top', 'outer', 'second'] }, async (walk) => {
    const edited = touching(walk.text, 'outer');
    await runTests(walk, [A, B], { over: edited });
    await forget(walk);

    check(walk, 'owed', await owed(walk), []);
    check(walk, 'the edit, no text kept', await ask(walk, edited), [A, B]);
  });
}

/**
 * A run of both tests over an uncommitted edit inside `outer`, the texts
 * landings kept forgotten, and a run of A over another edit inside the second
 * effect, asked of the tree as that run left it and of edits to it.
 *
 * The landing cannot find the text B ran over, so where B's regions stand in
 * the text A ran is not known: B is held flagged at every region of the module,
 * never dropped, and owed a run, so every edit runs it. An edit to a region B
 * entered in its own text selects it there; one to the first effect, which B
 * never entered, selects A and runs B as owed. A text that cannot be found
 * never becomes measured absence.
 */
export async function ranOverAnUnkeptTextThenAnother(ask: Ask, forget: (walk: Walk) => Promise<void>): Promise<void> {
  await walking(effects(), { [A]: ['top', 'outer', 'first'], [B]: ['top', 'outer', 'second'] }, async (walk) => {
    await runTests(walk, [A, B], { over: touching(walk.text, 'outer') });
    await forget(walk);
    const over = touching(walk.text, 'second');
    await runTests(walk, [A], { over });

    check(walk, 'the cases that ran each region', (await held(walk)).cases, { top: [A], outer: [A], first: [A], second: [] });
    check(walk, 'the cases not known to have run it', await flagged(walk), { top: [B], outer: [B], first: [B], second: [B] });
    check(walk, 'owed', await owed(walk), [B]);
    check(walk, 'the text A ran over', await ask(walk, over), []);
    check(walk, 'an edit in the second effect', await ask(walk, touching(over, 'second')), [B]);
    check(walk, 'an edit in the first effect', await ask(walk, touching(over, 'first')), [A]);
    check(walk, 'an edit in the function', await ask(walk, touching(over, 'outer')), [A, B]);
  });
}

/**
 * A run of both tests over an uncommitted edit inside `outer`, a commit of
 * another edit inside the first effect, a run of A alone, a run of other
 * tests, and the texts landings kept forgotten, with each step asked where,
 * when and over which text the test files a line names last ran.
 *
 * B last ran in the first landing, over the uncommitted text, and nothing
 * since ran it: the later landings carry it, and none re-dates it or says it
 * ran over the asked text. A ran over HEAD's text, the one asked. The record
 * holds the text B ran over while it is kept, and once it is forgotten still
 * says B ran over another text, holding none. Whether a region is the same in
 * both texts is `covering`'s verdict, and is asked of it.
 */
export async function ranOverThenCommittedElsewhere(ask: Ran, forget: (walk: Walk) => Promise<void>): Promise<void> {
  await walking(effects(), { [A]: ['top', 'outer', 'first'], [B]: ['top', 'outer', 'second'] }, async (walk) => {
    const landings: [string, number, number][] = [];
    const landing = async (name: string, body: () => Promise<void>): Promise<void> => {
      const from = Date.now();
      await body();
      landings.push([name, from, Date.now()]);
    };
    const commits: Record<string, string> = {};
    const named = (when: string): string => landings.find(([, from, to]) => from <= Date.parse(when) && Date.parse(when) <= to)?.[0] ?? when;
    const edit = touching(walk.text, 'outer');
    // Each stand by the commit and the landings the walk named, so a landing
    // that re-dated it or said it ran over the asked text shows as the wrong name.
    const read = (stood: Readonly<Record<string, Stood>>): Record<string, unknown> => Object.fromEntries(Object.entries(stood).map(([test, { commit, landed, text, held }]) => [test, {
      commit: commits[commit] ?? commit,
      landed: landed === undefined ? 'not held' : `${named(landed.first)} to ${named(landed.latest)}, runs ${String(landed.runs)}`,
      ran: text === undefined ? 'not said' : text === 'asked' ? 'the asked text' : 'another text',
      ...(held === undefined ? {} : { held: held ? 'a text' : 'no text' }),
    }]));
    const lines = walk.text.split('\n');
    const second = { line: lines.findIndex((line) => line.includes("hit('second')")) + 1 };
    const component = { lines: { startLine: lines.findIndex((line) => line.startsWith('export function component')) + 1, endLine: lines.lastIndexOf('}') + 1 } };

    commits[walk.head] = 'the first commit';
    await landing('both over an edit', () => runTests(walk, [A, B], { over: edit }));
    await commit(walk, touching(walk.text, 'first'), 'an edit inside the first effect');
    commits[walk.head] = 'the second commit';
    await landing('A alone', () => runTests(walk, [A]));

    const b = { commit: 'the first commit', landed: 'both over an edit to both over an edit, runs 1', ran: 'another text', held: 'a text' };
    check(walk, 'the second effect', read(await ask(walk, second)), { [B]: b });
    check(walk, 'the component', read(await ask(walk, component)), {
      [A]: { commit: 'the second commit', landed: 'A alone to A alone, runs 1', ran: 'the asked text' },
      [B]: b,
    });

    await landing('elsewhere', () => runElsewhere(walk));
    check(walk, 'the second effect after a run of other tests', read(await ask(walk, second)), { [B]: b });

    await forget(walk);
    check(walk, 'the second effect, no text kept', read(await ask(walk, second)), { [B]: { ...b, held: 'no text' } });
  });
}
