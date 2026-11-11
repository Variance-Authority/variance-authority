import { describe, expect, it } from 'vitest';
import type { SuiteReading } from './select-suite.js';
import { initial, selectionOf, transition, type Reach, type TestedInput, type TestedState } from './select-tested-state.js';

/**
 * The reconciliation machine of `variance select --tested`, one row per
 * transition: each open state, each input it can be handed, the state it
 * lands on, and what the selection of that state skips. Every unsafe or
 * unknown input lands on `widened`, which skips what the selection without
 * `--tested` skips.
 */

const MAINLINE = 'b'.repeat(40);
const TESTED = 't'.repeat(40);
const merge = { mainline: MAINLINE, tested: TESTED, fork: 'f'.repeat(40) };

/** The whole merge's selection: two test files recorded, `skipped` already skipped. */
function full(skipped: readonly string[] = [], ground: SuiteReading['reading']['ground'] = 'read', declined?: string): SuiteReading {
  const tests = ['test/a.test.ts', 'test/b.test.ts'];
  return {
    whole: new Set(tests),
    skip: new Set(skipped),
    ...(declined === undefined ? {} : { declined }),
    notes: [],
    reading: { ground, skip: skipped, because: 'as asked', notes: [], at: 'record', unread: [], ...(declined === undefined ? {} : { widened: declined }) },
  };
}

const A = 'test/a.test.ts';
const B = 'test/b.test.ts';
const reach = (code: readonly string[], install: readonly string[] = []): Reach => ({ code: new Set(code), install: new Set(install) });
const FULL = full();
const asked = initial(TESTED);
const selecting: TestedState = { kind: 'selecting', tested: TESTED, runs: [A, B] };
const merged: TestedState = { kind: 'merged', tested: TESTED, runs: [A, B], merge };
describe('the `--tested` reconciliation machine', () => {
  it.each<[string, TestedState, TestedInput, TestedState['kind'], readonly string[], string | undefined]>([
    ['a selection that narrowed opens the merge', asked, { kind: 'selected', full: FULL }, 'selecting', [], undefined],
    ['a selection that declined stays as it is', asked, { kind: 'selected', full: full([], 'read', 'every file') }, 'declined', [], undefined],
    ['a selection that read no record stays as it is', asked, { kind: 'selected', full: full([], 'no-journal') }, 'declined', [], undefined],
    ['a known clean merge reads the sides', selecting, { kind: 'merge', answer: { is: 'known', merge } }, 'merged', [], undefined],
    ['a tested tree that is HEAD merged nothing', selecting, { kind: 'merge', answer: { is: 'head' } }, 'current', [], `the tested tree is HEAD`],
    ['a HEAD that is not that merge widens', selecting, { kind: 'merge', answer: { is: 'apart', why: `HEAD is not ${MAINLINE.slice(0, 12)} with one pull request merged onto it` } }, 'widened', [], 'with one pull request merged onto it'],
    ['a dirty working tree widens', selecting, { kind: 'merge', answer: { is: 'dirty' } }, 'widened', [], 'the working tree changes files HEAD holds'],
    ['git that cannot answer widens', selecting, { kind: 'merge', answer: { is: 'unknown', why: 'git could not read it' } }, 'widened', [], 'git could not read it'],
    ['a pull request that declines alone widens', merged, { kind: 'sides', pull: { whole: 'before moved' }, main: reach([A]) }, 'widened', [], "read alone, the pull request's change selects every test file (before moved)"],
    ['a mainline that declines alone widens', merged, { kind: 'sides', pull: reach([A]), main: { whole: 'no install' } }, 'widened', [], "read alone, the mainline's change selects every test file (no install)"],
    ['both sides reaching every running test keep it', merged, { kind: 'sides', pull: reach([A, B]), main: reach([A, B]) }, 'kept', [], 'both sides of the merge reach every test file'],
    ['an install on either side keeps what it reaches', merged, { kind: 'sides', pull: reach([A], [B]), main: reach([A]) }, 'kept', [], 'both sides of the merge reach every test file'],
    ['a test only one side reaches is skipped', merged, { kind: 'sides', pull: reach([A, B]), main: reach([A]) }, 'narrowed', [B], `${B}: only the pull request reaches it, and it passed at the tested tree ${TESTED.slice(0, 12)}`],
    ['disjoint sides skip every running test', merged, { kind: 'sides', pull: reach([B]), main: reach([A]) }, 'empty', [A, B], 'the pull request and the mainline it meets reach no test in common'],
    ['an input the open state does not expect widens', selecting, { kind: 'sides', pull: reach([B]), main: reach([A]) }, 'widened', [], 'did not expect'],
    ['an input before the selection widens', asked, { kind: 'merge', answer: { is: 'known', merge } }, 'widened', [], 'did not expect'],
  ])('%s', (_, from, input, to, skip, says) => {
    const state = transition(from, input);

    expect(state.kind).toBe(to);
    expect([...selectionOf(state, FULL).skip]).toEqual(skip);
    if (says !== undefined) expect(selectionOf(state, FULL).notes.join('\n')).toContain(says);
  });

  it('keeps a skip the selection already made, and adds what one side reaches alone', () => {
    const state = transition({ kind: 'merged', tested: TESTED, runs: [B], merge }, { kind: 'sides', pull: reach([]), main: reach([B]) });

    expect(state.kind).toBe('empty');
    expect([...selectionOf(state, full([A])).skip]).toEqual([A, B]);
    expect(selectionOf(state, full([A])).notes.join('\n')).toContain(`${B}: only the mainline reaches it, and it passed at ${MAINLINE.slice(0, 12)}`);
  });

  it.each<TestedState>([
    { kind: 'declined', tested: TESTED },
    { kind: 'current', tested: TESTED },
    { kind: 'widened', tested: TESTED, cause: 'unknown', why: 'unknown' },
  ])('stays at the final state $kind whatever it is handed', (final) => {
    expect(transition(final, { kind: 'merge', answer: { is: 'known', merge } })).toBe(final);
  });

  it('answers an open state as without `--tested`', () => {
    expect([...selectionOf(merged, FULL).skip]).toEqual([]);
    expect(selectionOf(selecting, FULL)).toBe(FULL);
  });
});
