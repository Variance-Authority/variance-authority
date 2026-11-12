import { describe, expect, it } from 'vitest';
import { sensitivityLedgerOf, summarizeSensitivities } from './sensitivities.js';
import type { CliObservationRecord } from './run-report.js';
import type { PlannedSubject } from './collector.js';
import type { SensitivityConfig } from '../config.js';

/**
 * The accounting, which is the half that keeps a declaration from becoming a
 * blind spot.
 *
 * Absorbing works or it does not, and `packages/observe` asserts that. What is
 * asserted here is that the run can still be *asked*: which rule relaxed which
 * subjects, which rule relaxed nothing, and which rule matched nothing at all.
 * Those last two are different failures — a policy that has outlived its cause
 * against a typo — and a ledger that printed one sentence for both would tell an
 * operator to delete the wrong line.
 */

const ROUTES: SensitivityConfig = {
  id: 'routes',
  reason: 'a route asserts the page assembles, not what it is painted',
  level: 'layout',
  subjects: ['route/*'],
};

function planned(...ids: readonly string[]): readonly PlannedSubject[] {
  return ids.map((id) => ({ subject: { id, kind: 'route' as const } }));
}

function absorbed(subject: string, rule = 'routes'): CliObservationRecord {
  return {
    subject,
    verdict: 'ignored',
    because: 'every band that moved is one this subject is not asserted on',
    changedPixels: 0,
    regions: [],
    relaxed: { rule, level: 'layout', bands: ['token'] },
  };
}

function reported(subject: string): CliObservationRecord {
  return {
    subject,
    verdict: 'changed',
    because: 'the nav moved',
    changedPixels: 400,
    regions: [],
  };
}

describe('what a rule did this run', () => {
  it('counts the subjects it decided against the subjects it reached', () => {
    const ledger = sensitivityLedgerOf(
      [ROUTES],
      planned('route/home', 'route/pricing', 'route/about'),
      [absorbed('route/home'), absorbed('route/pricing'), reported('route/about')],
    );

    // Two numbers, never one. "Absorbed 2" alone reads as a rule doing its job;
    // "2 of 3" is what tells an operator the third route still reports, which is
    // the evidence that the level is narrow rather than a mute button.
    expect(ledger?.rules[0]).toMatchObject({
      rule: 'routes',
      level: 'layout',
      scoped: 3,
      absorbed: ['route/home', 'route/pricing'],
      bands: ['token'],
    });
    expect(ledger?.totalAbsorbed).toBe(2);
  });

  it('prints the level positively, with the absorption as the evidence beside it', () => {
    const ledger = sensitivityLedgerOf([ROUTES], planned('route/home'), [absorbed('route/home')]);

    const line = summarizeSensitivities(ledger).join('\n');

    expect(line).toContain('asserts on layout');
    expect(line).toContain('absorbed token difference(s) in 1 of 1 subject(s)');
    expect(line).toContain('a route asserts the page assembles');
  });
});

describe('the two ways a declaration stops being worth having', () => {
  it('names a rule that reached subjects and absorbed nothing as dead', () => {
    const ledger = sensitivityLedgerOf([ROUTES], planned('route/home'), [reported('route/home')]);

    // A route declared `layout` that has reported no token change in six months
    // is either a route nothing styles or a declaration nobody needed. Both are
    // worth a line, and neither is visible without the count of zero.
    expect(ledger?.rules[0]?.absorbed).toEqual([]);
    expect(summarizeSensitivities(ledger).join('\n')).toContain('[dead]');
  });

  it('names a rule that reached no subject as unscoped, which is a typo', () => {
    const ledger = sensitivityLedgerOf([ROUTES], planned('story:button--primary'), []);

    // Different from dead, and the operator's next move is different: `dead`
    // means delete the policy, `unscoped` means fix the pattern. One word for
    // both would send half of them to the wrong edit.
    const line = summarizeSensitivities(ledger).join('\n');
    expect(ledger?.rules[0]?.unscoped).toBe(true);
    expect(line).toContain('[unscoped]');
    expect(line).toContain('matched no subject this run planned');
  });
});

describe('a run that declared nothing', () => {
  it('produces no ledger at all, rather than an empty one', () => {
    // Absent and empty are different states everywhere else in this system and
    // are here too: a run with no sensitivities has nothing to account for, and
    // a heading over an empty list invites a reader to conclude that something
    // was checked.
    expect(sensitivityLedgerOf([], planned('route/home'), [])).toBeUndefined();
    expect(summarizeSensitivities(undefined)).toEqual([]);
  });
});
