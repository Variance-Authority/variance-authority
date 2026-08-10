import { describe, expect, it } from 'vitest';
import type { ProfileId } from '@variance-authority/core';
import type { Band, Observation, RunRecord, TokenValue } from './observation.js';
import type { Churn, Journey, Reach } from './store.js';
import {
  accumulateChurn,
  describeChurn,
  describeDrift,
  describeLastChanged,
  describeReach,
  detectDrift,
} from './drift.js';

/**
 * The arithmetic, on hand-written histories.
 *
 * Every test here is one of the four rules the numbers depend on, plus the ways
 * each of them fails quietly. They are worth writing at this level because the
 * failures are all *plausible*: an inflated churn rate, a journey through
 * rejected commits, and a container blamed for being displaced all produce
 * numbers that look exactly like findings.
 */

function iso(day: number): string {
  return `2026-01-${String(day).padStart(2, '0')}T00:00:00Z`;
}

function run(id: string, profile: ProfileId = 'chromium', day = 1): RunRecord {
  return { project: 'shop', run: id, commit: `commit-${id}`, profile, at: iso(day) };
}

function runs(count: number, profile: ProfileId = 'chromium'): readonly RunRecord[] {
  return Array.from({ length: count }, (_, index) => run(`r${index + 1}`, profile, index + 1));
}

interface RowSpec {
  readonly run: string;
  readonly band: Band;
  readonly profile?: ProfileId;
  readonly accepted?: boolean;
  readonly component?: string;
  readonly subject?: string;
  readonly day?: number;
}

function row(spec: RowSpec): Observation {
  return {
    project: 'shop',
    subject: spec.subject ?? 'story:card',
    component: spec.component ?? 'Button',
    band: spec.band,
    hash: `v1:${spec.run}${spec.band}`,
    profile: spec.profile ?? 'chromium',
    commit: `commit-${spec.run}`,
    run: spec.run,
    at: iso(spec.day ?? 1),
    accepted: spec.accepted ?? true,
  };
}

function bandOf(churn: Churn, band: Band, profile?: ProfileId) {
  return churn.bands.find((entry) => entry.band === band && entry.profile === profile);
}

function journey(values: readonly string[], omitted = 0): Journey {
  return {
    token: '--va-space-3',
    window: {},
    values: values.map(
      (value, index): TokenValue => ({
        project: 'shop',
        token: '--va-space-3',
        value,
        commit: `commit-${index + 1}`,
        at: iso(index + 1),
      }),
    ),
    omitted,
  };
}

describe('churn', () => {
  it('counts quiet runs in the denominator, and reports a higher rate without them', () => {
    // Spec 0002 acceptance 3 asks for both halves in one test, so the reason stays
    // visible: the difference between 10% and 100% here is entirely whether the
    // runs in which nothing happened were recorded.
    const changed = [1, 2, 3, 4].map((index) => row({ run: `r${index}`, band: 'structure' }));

    const whole = accumulateChurn({ component: 'Button', runs: runs(40), observations: changed });
    const partial = accumulateChurn({
      component: 'Button',
      runs: [run('r1'), run('r2'), run('r3'), run('r4')],
      observations: changed,
    });

    expect(bandOf(whole, 'structure')).toMatchObject({ runs: 40, changes: 4, rate: 0.1 });
    expect(bandOf(partial, 'structure')).toMatchObject({ runs: 4, changes: 4, rate: 1 });
  });

  it('sums only approved changes', () => {
    // A rejected change was caught. Counting it would describe the review process
    // rather than the product, in the direction that looks alarming.
    const churn = accumulateChurn({
      component: 'Button',
      runs: runs(10),
      observations: [
        row({ run: 'r1', band: 'structure', accepted: false }),
        row({ run: 'r2', band: 'structure', accepted: false }),
        row({ run: 'r3', band: 'structure', accepted: true }),
      ],
    });

    expect(bandOf(churn, 'structure')).toMatchObject({ changes: 1 });
    expect(churn.rejectedRuns).toBe(2);
  });

  it('counts a change a reviewer approved afterwards, which is how every change arrives', () => {
    // The defect this closes: a run writes every row `accepted: false`, correctly,
    // because acceptance happens later and by somebody who looked. Without the
    // approvals slice, a component that changed in every run of a quarter reports
    // as never having changed — a zero that looks exactly like stability.
    const observations = [
      row({ run: 'r1', band: 'structure', accepted: false }),
      row({ run: 'r2', band: 'structure', accepted: false }),
    ];

    const unreviewed = accumulateChurn({ component: 'Button', runs: runs(10), observations });
    expect(bandOf(unreviewed, 'structure')).toMatchObject({ changes: 0 });

    const reviewed = accumulateChurn({
      component: 'Button',
      runs: runs(10),
      observations,
      approvals: [
        { project: 'shop', subject: 'story:card', run: 'r1', at: iso(1) },
        { project: 'shop', subject: 'story:card', run: 'r2', at: iso(2) },
      ],
    });
    expect(bandOf(reviewed, 'structure')).toMatchObject({ changes: 2 });
    expect(reviewed.rejectedRuns).toBe(0);
  });

  it('approves the subject that was reviewed and not the one beside it', () => {
    // An approval names a `(subject, run)` because that is the decision a reviewer
    // makes. Keyed per run instead, one approved subject would approve the forty
    // nobody looked at.
    const churn = accumulateChurn({
      component: 'Button',
      runs: runs(4),
      observations: [
        row({ run: 'r1', band: 'structure', accepted: false, subject: 'story:card' }),
        row({ run: 'r1', band: 'structure', accepted: false, subject: 'story:panel' }),
      ],
      approvals: [{ project: 'shop', subject: 'story:card', run: 'r1', at: iso(1) }],
    });

    expect(bandOf(churn, 'structure')).toMatchObject({ changes: 1 });
    // And the unreviewed one is still counted as rejected rather than forgotten.
    expect(churn.rejectedRuns).toBe(1);
  });

  it('accumulates nothing for a component that is collateral in every run', () => {
    // Spec 0002 acceptance 2. A component whose geometry moved while its own
    // structure and style held was displaced by an edit elsewhere; summing that
    // makes the widest container in the application the thing that keeps changing,
    // in every run, forever.
    const churn = accumulateChurn({
      component: 'Stack',
      runs: runs(10),
      observations: Array.from({ length: 10 }, (_, index) =>
        row({ run: `r${index + 1}`, band: 'geometry', component: 'Stack' }),
      ),
    });

    expect(churn.changedRuns).toBe(0);
    expect(bandOf(churn, 'geometry', 'chromium')).toMatchObject({ changes: 0, rate: 0 });
    // Counted as displacement rather than dropped: zero changes and zero
    // observations are different facts about a component.
    expect(churn.collateralRuns).toBe(10);
  });

  it('counts a component’s own geometry movement when its code moved in the same run', () => {
    // The other half of the collateral rule. Geometry is not ignored — it is
    // ignored *when nothing of the component itself moved*.
    const churn = accumulateChurn({
      component: 'Button',
      runs: runs(4),
      observations: [
        row({ run: 'r1', band: 'style' }),
        row({ run: 'r1', band: 'geometry' }),
      ],
    });

    expect(bandOf(churn, 'geometry', 'chromium')).toMatchObject({ changes: 1 });
    expect(churn.collateralRuns).toBe(0);
  });

  it('counts one edit seen by two tiers as one structural change', () => {
    // Structure is portable across tiers (measured 107/107). Counting per tier
    // would double the structural rate of every project that runs both.
    const churn = accumulateChurn({
      component: 'Button',
      runs: [run('r1', 'chromium'), run('r1', 'jsdom')],
      observations: [
        row({ run: 'r1', band: 'structure', profile: 'chromium' }),
        row({ run: 'r1', band: 'structure', profile: 'jsdom' }),
      ],
    });

    expect(churn.runs).toBe(1);
    expect(bandOf(churn, 'structure')).toMatchObject({ runs: 1, changes: 1, rate: 1 });
  });

  it('keeps style rates inside one tier rather than blending them', () => {
    // Style agrees across profiles on 0 of 107 component boundaries. A blended
    // rate would measure which tier ran, not what anyone edited.
    const churn = accumulateChurn({
      component: 'Button',
      runs: [run('r1', 'chromium'), run('r1', 'jsdom'), run('r2', 'chromium'), run('r2', 'jsdom')],
      observations: [
        row({ run: 'r1', band: 'style', profile: 'chromium' }),
        row({ run: 'r2', band: 'style', profile: 'jsdom' }),
      ],
    });

    expect(bandOf(churn, 'style', 'chromium')).toMatchObject({ runs: 2, changes: 1 });
    expect(bandOf(churn, 'style', 'jsdom')).toMatchObject({ runs: 2, changes: 1 });
  });

  it('reports no geometry entry at all for a tier with no layout engine', () => {
    // A `0 / 12` geometry rate under jsdom would state that nothing moved, when
    // the truth is that nothing looked.
    const churn = accumulateChurn({
      component: 'Button',
      runs: runs(12, 'jsdom'),
      observations: [row({ run: 'r1', band: 'structure', profile: 'jsdom' })],
    });

    expect(churn.bands.map((entry) => `${entry.band}/${entry.profile ?? 'any'}`)).toEqual([
      'structure/any',
      'style/jsdom',
    ]);
  });

  it('refuses a geometry row recorded under a tier that cannot observe geometry', () => {
    // Its existence means something upstream wrote a zero where it should have
    // written nothing.
    expect(() =>
      accumulateChurn({
        component: 'Button',
        runs: runs(2, 'jsdom'),
        observations: [row({ run: 'r1', band: 'geometry', profile: 'jsdom' })],
      }),
    ).toThrow(/no layout engine/);
  });

  it('refuses to divide changes by a denominator that was not supplied', () => {
    // Changes with no runs behind them is an incomplete slice, and a rate over a
    // missing denominator is the inflated rate this file exists to prevent.
    expect(() =>
      accumulateChurn({
        component: 'Button',
        runs: [run('r1', 'jsdom')],
        observations: [row({ run: 'r1', band: 'style', profile: 'chromium' })],
      }),
    ).toThrow(/runs slice is incomplete/);
  });

  it('refuses rows belonging to another component', () => {
    // A mixed slice inflates the rate of whichever component was asked about.
    expect(() =>
      accumulateChurn({
        component: 'Button',
        runs: runs(2),
        observations: [row({ run: 'r1', band: 'structure', component: 'Badge' })],
      }),
    ).toThrow(/row for `Badge`/);
  });
});

describe('churn, as a sentence', () => {
  it('states the fraction, not only the percentage', () => {
    const churn = accumulateChurn({
      component: 'Button',
      runs: runs(40),
      observations: [row({ run: 'r1', band: 'structure' })],
    });

    // "2.5%" alone hides how much history is behind it; 1 of 40 and 1 of 4 are
    // different claims and one of them is noise.
    expect(describeChurn(churn)).toContain('1 of 40 run(s) (2.5%)');
  });

  it('names collateral as displacement rather than leaving it out', () => {
    const churn = accumulateChurn({
      component: 'Stack',
      runs: runs(10),
      observations: [row({ run: 'r1', band: 'geometry', component: 'Stack' })],
    });

    expect(describeChurn(churn)).toContain('displaced by an edit elsewhere, and not counted');
  });

  it('says a window with no runs is unanswerable rather than stable', () => {
    // An unobservable difference is never reported as no difference.
    const sentence = describeChurn(
      accumulateChurn({ component: 'Button', runs: [], observations: [] }),
    );

    expect(sentence).toContain('unanswerable');
    expect(sentence).toContain('not the same as it having been stable');
  });

  it('admits when a limit excluded part of the window', () => {
    const churn = accumulateChurn({
      component: 'Button',
      runs: runs(10),
      observations: [row({ run: 'r1', band: 'structure' })],
      window: { limit: 10 },
      omittedRuns: 30,
      omittedObservations: 2,
    });

    // A capped answer that does not say it was capped reads as a complete one.
    expect(describeChurn(churn)).toContain('excluded 30 run(s) and 2 row(s)');
  });
});

describe('token journeys', () => {
  it('reports a total that no single approval could have shown', () => {
    // The case the store exists for: eight correct approvals, one unreviewed 8px.
    const drift = detectDrift(
      journey(['12px', '13px', '14px', '15px', '16px', '17px', '18px', '19px', '20px']),
    );

    expect(drift).not.toBeNull();
    expect(drift?.quantity).toMatchObject({ from: 12, to: 20, net: 8, largestStep: 1, travel: 8 });
    expect(drift?.steps).toHaveLength(8);
    expect(drift?.notable).toBe(true);
    expect(describeDrift(drift!)).toContain('12px → 20px');
    expect(describeDrift(drift!)).toContain('the largest single step was 1px');
  });

  it('does not report a single large step as a hidden journey', () => {
    // It was reviewable as one change, and whoever approved it saw its full size.
    const drift = detectDrift(journey(['12px', '20px']));

    expect(drift?.notable).toBe(false);
    expect(describeDrift(drift!)).toContain('reviewable as one change');
  });

  it('reports a value that came back to where it started', () => {
    // Net zero, travel eight. A store reporting only the net would call this
    // stable, and it is the opposite of stable.
    const drift = detectDrift(journey(['12px', '16px', '12px']));

    expect(drift?.quantity).toMatchObject({ net: 0, travel: 8, largestStep: 4 });
    expect(describeDrift(drift!)).toContain('returned to 12px after 8px of movement');
  });

  it('does not report a value that was rewritten without moving', () => {
    // `12px → 12.0px` is a change of notation. Reporting it as drift puts a
    // finding in front of somebody that no amount of reading the commits explains.
    const drift = detectDrift(journey(['12px', '12.0px', '12px']));

    expect(drift?.quantity).toMatchObject({ travel: 0 });
    expect(drift?.notable).toBe(false);
    expect(describeDrift(drift!)).toContain('rewritten 2 time(s) without moving');
  });

  it('is null when the token genuinely did not move', () => {
    // An observed absence of change: the values were recorded, read, and equal.
    expect(detectDrift(journey(['12px', '12px', '12px']))).toBeNull();
  });

  it('is never null when a limit excluded values', () => {
    // Null would claim a stability the slice cannot support.
    const drift = detectDrift(journey(['12px', '12px'], 5));

    expect(drift?.incomplete).toBe(true);
    expect(describeDrift(drift!)).toContain('nothing here rules out drift');
  });

  it('marks every total as a lower bound while the journey is incomplete', () => {
    const drift = detectDrift(journey(['12px', '14px', '16px'], 3));

    expect(describeDrift(drift!)).toContain('at least');
    expect(describeDrift(drift!)).toContain('lower bound');
  });

  it('reports the count for values that are not quantities, and says why', () => {
    // A colour cannot be subtracted. Reporting nothing would turn "changed five
    // times this quarter" into silence.
    const drift = detectDrift({ ...journey(['#111111', '#222222', '#333333']), token: '--brand' });

    expect(drift?.quantity).toBeUndefined();
    expect(drift?.unquantifiable).toContain('not single quantities');
    expect(drift?.notable).toBe(true);
    expect(describeDrift(drift!)).toContain('not measurable');
  });

  it('reports a unit change instead of subtracting across it', () => {
    // 1rem minus 16px is a number nobody should print.
    const drift = detectDrift(journey(['12px', '16px', '1rem']));

    expect(drift?.quantity).toBeUndefined();
    expect(drift?.unquantifiable).toContain('change unit');
  });

  it('folds repeated readings of one value into one step', () => {
    // A token that resolved the same way in forty runs did not move forty times.
    const drift = detectDrift(journey(['12px', '12px', '14px', '14px', '16px']));

    expect(drift?.steps).toHaveLength(2);
    expect(drift?.readings).toBe(5);
  });

  it('orders the journey by time rather than trusting the slice', () => {
    // `20px → 12px` is a confident sentence that is exactly backwards.
    const forwards = journey(['12px', '16px', '20px']);
    const drift = detectDrift({ ...forwards, values: [...forwards.values].reverse() });

    expect(drift?.from).toBe('12px');
    expect(drift?.to).toBe('20px');
  });

  it('refuses a slice that excluded every value it had', () => {
    expect(() => detectDrift(journey([], 4))).toThrow(/excluded everything/);
  });
});

describe('reach and last change, as sentences', () => {
  it('leads with the subjects a component newly appears in', () => {
    const reach: Reach = {
      component: 'Button',
      window: {},
      subjects: ['a', 'b', 'c', 'd', 'e'],
      arrived: ['c', 'd', 'e'],
      omittedSubjects: 2,
    };

    // Arrival is the part a single run cannot see, and the part nobody reviewed
    // as one change.
    expect(describeReach(reach)).toContain('3 of them saw it for the first time');
    expect(describeReach(reach)).toContain('excluded 2 further subject(s)');
  });

  it('distinguishes a record that contains no such change from no record', () => {
    // `null` is an answer from a store that has been keeping one. The other case
    // is `Unkept`, and the two must never share a sentence.
    expect(describeLastChanged('story:card', 'Button', null)).toContain(
      'the record exists and does not contain it',
    );
  });

  it('names the commit, the tier and the file of the last change', () => {
    const sentence = describeLastChanged('story:card', 'Button', {
      ...row({ run: 'r7', band: 'style' }),
      file: 'src/Button.tsx',
    });

    // Everything an agent needs to act without asking a second question.
    expect(sentence).toContain('commit commit-r7');
    expect(sentence).toContain('observed by chromium');
    expect(sentence).toContain('src/Button.tsx');
  });
});
