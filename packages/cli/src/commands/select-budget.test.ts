import { describe, expect, it } from 'vitest';
import { kept, type ExecutionNarrowing, type SuiteTimes, type TestDistance } from '@variance-authority/sense/test-selection';
import { withinBudget } from './select-budget.js';
import type { Leg } from './select-leg.js';
import { suiteOf } from './select-suite.js';
import type { SelectInput } from './select.js';

/**
 * `VARIANCE_AUTHORITY_BUDGET`: the edit loop's ceiling of recorded test time.
 *
 * The cut orders what the leg selected — the changed files' own tests, then
 * importers in their package, then importers in other packages, nearest first
 * and shortest first — and takes files until the next would pass the ceiling.
 * It only ever adds to the skip list, so it runs nothing the selection did not.
 */

const CHANGED = 'packages/a/src/widget.ts';
const EDITED = 'packages/a/src/edited.test.ts';
const OWN = 'packages/a/src/widget.test.ts';
const OTHER = 'packages/a/src/other.test.ts';
const UNTIMED = 'packages/a/src/untimed.test.ts';
const FAR = 'packages/a/src/far.test.ts';
const USES = 'packages/b/src/uses.test.ts';
const GHOST = 'packages/b/src/ghost.test.ts';
const IDLE = 'packages/b/src/idle.test.ts';
const WHOLE = [EDITED, FAR, GHOST, IDLE, OTHER, OWN, UNTIMED, USES];
const DISTANCES: readonly TestDistance[] = [
  { test: EDITED, bearing: 'precondition', hops: 0, from: EDITED },
  { test: OWN, bearing: 'direct', hops: 1, from: CHANGED, enters: [CHANGED] },
  { test: OTHER, bearing: 'direct', hops: 1, from: CHANGED, enters: [CHANGED] },
  { test: UNTIMED, bearing: 'direct', hops: 1, from: CHANGED, enters: [CHANGED] },
  { test: USES, bearing: 'direct', hops: 1, from: CHANGED, enters: [CHANGED] },
  { test: FAR, bearing: 'transitive', hops: 2, from: CHANGED },
  { test: GHOST, bearing: 'unexplained' },
];
const TIMES: SuiteTimes = {
  recording: '/cache/coverage.bin',
  times: new Map([[EDITED, 3000], [OWN, 4000], [OTHER, 9000], [FAR, 1000], [USES, 500], [GHOST, 200], [IDLE, 100]]),
};
const home = (file: string) => file.split('/').slice(0, 2).join('/');

function input(): SelectInput {
  const narrowing: ExecutionNarrowing = {
    whole: WHOLE,
    entered: WHOLE.filter((test) => test !== IDLE),
    unread: [],
    stale: [],
    because: [],
  };
  return { at: '/cache/coverage.bin', commit: 'c0ffee', ground: { kind: 'read', narrowing, distances: DISTANCES } };
}

const leg = (from: number, to: number): Leg => ({ from, to, by: 'environment' });
const runs = (selection: Parameters<typeof kept>[0]) => kept(selection, WHOLE);

describe('the edit loop under a budget', () => {
  it('runs only the changed files\' own tests when no distance was asked, as many as fit', () => {
    const cut = withinBudget(suiteOf(input(), leg(0, 1)), TIMES, { seconds: 15, asked: false }, home);

    // 3 s and 4 s fit; the next own test, 9 s, would pass 15 s. The importer in another package is not own.
    expect(runs(cut)).toEqual([EDITED, OWN]);
    expect([...cut.left ?? []].sort()).toEqual([FAR, OTHER, UNTIMED, GHOST, USES]);
  });

  it('takes the changed files\' own tests shortest first, whatever their hops', () => {
    const times: SuiteTimes = { recording: '/cache/coverage.bin', times: new Map([...TIMES.times, [EDITED, 5000]]) };
    const cut = withinBudget(suiteOf(input(), leg(0, 1)), times, { seconds: 4, asked: false }, home);

    // The edited test is 0 hops and 5 s; the 4 s test one hop away is taken before it, and fits.
    expect(runs(cut)).toEqual([OWN]);
  });

  it('says what it ran and what it left', () => {
    const cut = withinBudget(suiteOf(input(), leg(0, 1)), TIMES, { seconds: 15, asked: false }, home);

    expect(cut.notes).toContain('`VARIANCE_AUTHORITY_BUDGET=15` ran 2 of 5 selected, 7.0 s of 25.5 s recorded; 3 are left for CI:');
    expect(cut.notes).toContain(`  ${OTHER}, 9.0 s`);
    expect(cut.notes).toContain(`  ${UNTIMED}, 9.0 s`);
    expect(cut.notes).toContain(`  ${USES}, 500 ms`);
  });

  it('takes own tests, then importers in their package, then importers in other packages, when a distance was asked', () => {
    const cut = withinBudget(suiteOf(input(), leg(0, 2)), TIMES, { seconds: 26, asked: true }, home);

    // 25 s of own tests, then the 1 s importer two hops away in the same package before the 0.5 s one hop away in another.
    expect(runs(cut)).toEqual([EDITED, FAR, OTHER, OWN, UNTIMED]);
    expect([...cut.left ?? []].sort()).toEqual([GHOST, USES]);
  });

  it('counts a file with no recorded duration at the slowest recorded duration of its package', () => {
    const cut = withinBudget(suiteOf(input(), leg(0, 1)), TIMES, { seconds: 25, asked: true }, home);

    // Priced at package a's 9 s, the untimed test fills the 25 s, and the 0.5 s importer no longer fits.
    expect(runs(cut)).toContain(UNTIMED);
    expect(runs(cut)).not.toContain(USES);
  });

  it.each([[false, 15], [true, 26], [true, 1000], [false, 0]])('selects no file the leg did not, asked %s within %s s', (asked, seconds) => {
    const whole = suiteOf(input(), leg(0, 2));
    const cut = withinBudget(whole, TIMES, { seconds, asked }, home);

    expect(runs(cut).every((file) => runs(whole).includes(file))).toBe(true);
    expect([...whole.skip].every((file) => cut.skip.has(file))).toBe(true);
  });

  it('cuts nothing from a selection that declined to narrow, and says why', () => {
    const declined: SelectInput = { at: '/cache/coverage.bin', ground: { kind: 'no-journal' } };
    const whole = suiteOf(declined, leg(0, 1));
    const cut = withinBudget(whole, TIMES, { seconds: 15, asked: false }, home);

    expect(cut.skip).toEqual(whole.skip);
    expect(cut.notes[0]).toMatch(/^`VARIANCE_AUTHORITY_BUDGET=15` cuts nothing: /u);
  });

  describe('a suite a local change runs whole, because it moved a `before` entry', () => {
    const SETUP = 'packages/a/vitest.setup.ts';
    const before: SelectInput = { at: '/cache/coverage.bin', ground: { kind: 'before', whole: `the suite rests on ${SETUP}`, rests: [SETUP] } };
    const local = (changed: readonly string[]) => ({ ...suiteOf(before, leg(0, 2)), changed });

    it('runs the test files the change edited, and leaves every other test file of the suite to CI', () => {
      const cut = withinBudget(local([SETUP, OWN, EDITED]), TIMES, { seconds: 20, asked: true }, home);

      expect(runs(cut)).toEqual([EDITED, OWN]);
      expect(cut.declined).toBeUndefined();
      expect(cut.notes[0]).toBe(
        `\`VARIANCE_AUTHORITY_BUDGET=20\` ran 2 of the 2 test files the change edited, 7.0 s recorded; ` +
          `every other test file of the suite is left for CI, which runs it whole: the suite rests on ${SETUP}`,
      );
    });

    it('takes the edited test files shortest first, as many as fit', () => {
      const cut = withinBudget(local([SETUP, OWN, EDITED]), TIMES, { seconds: 5, asked: false }, home);

      expect(runs(cut)).toEqual([EDITED]);
      expect(cut.notes).toContain(`  ${OWN}, 4.0 s`);
    });

    it('runs no test when the change edited none', () => {
      const cut = withinBudget(local([SETUP]), TIMES, { seconds: 20, asked: true }, home);

      expect(runs(cut)).toEqual([]);
    });

    it('cuts nothing from the same reading off a local seam, which carries no change', () => {
      const whole = suiteOf(before, leg(0, 2));
      const cut = withinBudget(whole, TIMES, { seconds: 20, asked: true }, home);

      expect(runs(cut)).toEqual(WHOLE);
      expect(cut.notes[0]).toMatch(/^`VARIANCE_AUTHORITY_BUDGET=20` cuts nothing: /u);
    });
  });

  it('cuts nothing from a selection `--local` fell to, which holds no hops, and says why', () => {
    const whole = suiteOf(input(), undefined);
    const fell = { ...whole, reading: { ...whole.reading, fell: { rung: 'importers' as const, from: 'no journal', left: [] } } };
    const cut = withinBudget(fell, TIMES, { seconds: 1, asked: false }, home);

    expect(cut.skip).toEqual(whole.skip);
    expect(cut.notes[0]).toMatch(/^`VARIANCE_AUTHORITY_BUDGET=1` cuts nothing: the selection fell to/u);
  });

  it('cuts nothing when the record holds no times, and says why', () => {
    const whole = suiteOf(input(), leg(0, 1));
    const cut = withinBudget(whole, { unread: 'nothing is recorded there' }, { seconds: 15, asked: false }, home);

    expect(cut.skip).toEqual(whole.skip);
    expect(cut.notes[0]).toBe('`VARIANCE_AUTHORITY_BUDGET=15` cuts nothing: nothing is recorded there');
  });

  it('cuts nothing when the record holds a run with no file timed, and says why', () => {
    const whole = suiteOf(input(), leg(0, 1));
    const cut = withinBudget(whole, { recording: '/cache/coverage.bin', times: new Map() }, { seconds: 15, asked: false }, home);

    expect(cut.skip).toEqual(whole.skip);
    expect(cut.notes[0]).toMatch(/^`VARIANCE_AUTHORITY_BUDGET=15` cuts nothing: /u);
  });

  it('cuts nothing when the hops were measured on a graph that is not the checkout\'s, and says why', () => {
    const read = input();
    const stale: SelectInput = { ...read, ground: { ...read.ground, stale: 'the source index could not be brought up to it' } as SelectInput['ground'] };
    const whole = suiteOf(stale, leg(0, Number.MAX_SAFE_INTEGER));
    const cut = withinBudget(whole, TIMES, { seconds: 15, asked: false }, home);

    expect(runs(cut)).toEqual(runs(whole));
    expect(cut.notes[0]).toMatch(/^`VARIANCE_AUTHORITY_BUDGET=15` cuts nothing: /u);
  });
});
