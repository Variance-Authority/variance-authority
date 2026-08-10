import { profileById, type ProfileId } from '@variance-authority/core';
import { approvalKey, type Approval } from './approval.js';
import { instant } from './instant.js';
import type { Band, Observation, RunRecord } from './observation.js';
import type { BandChurn, Churn, Window } from './store.js';

/**
 * The arithmetic, over rows somebody else fetched.
 *
 * Pure and synchronous on purpose. The numbers this file produces are the ones a
 * reviewer will act on — "changed in 4 of 40 runs", "12px → 20px across eight
 * approvals" — and every way of getting them wrong is a way of being confidently
 * wrong. Keeping them in functions over plain rows means each rule below is a
 * test with a hand-written history behind it rather than a query somebody has to
 * trust.
 *
 * Four rules, each of which is a defect if broken.
 *
 * **Only approved changes count.** A rejected change was caught. Counting it
 * describes the review process instead of the product, and does so in the
 * direction that looks alarming.
 *
 * **Collateral never accumulates.** A component whose `geometry` moved while its
 * own `structure` and `style` held was displaced by an edit somewhere else. Sum
 * displacement and the widest container in the application becomes the thing that
 * keeps changing, in every run, forever — the same defect that made pixel area
 * rank `Stack`, which nothing edited, above `Toggle`, which was the edit (journal
 * 0013).
 *
 * **Quiet runs are the denominator.** A rate computed only from runs that changed
 * something is not a rate. It reports "changed in 4 of 4 runs" for a component
 * that changed in 4 of 40, and every reader takes it at face value.
 *
 * **Bands are only compared where they are comparable.** `structure` is portable
 * across tiers and is counted across all of them; `style` and `geometry` are not,
 * and a rate that crossed profiles on either would measure which tier ran rather
 * than what anyone edited (measured: style agrees across profiles on 0 of 107
 * component boundaries).
 */

export interface ChurnInput {
  readonly component: string;

  /**
   * Every run in the window, including the ones in which nothing changed. One
   * entry per `(run, profile)`: a run that captured under two tiers is two
   * records sharing a run id, and the arithmetic counts distinct ids wherever the
   * question does not depend on the tier.
   */
  readonly runs: readonly RunRecord[];

  /** Every recorded row for this component in the window, approved or not. */
  readonly observations: readonly Observation[];

  /**
   * Acceptances recorded in the window, by `(subject, run)`.
   *
   * The half a run cannot supply. A run writes every row `accepted: false` —
   * correctly, because acceptance happens afterwards and by somebody who looked
   * — so without these, "drift sums only approved changes" sums nothing at all.
   *
   * Absent is *not* "nothing was approved". It is a caller that did not fetch
   * them, and the difference matters: a churn computed without the approvals
   * slice reports a component that changed forty times as never having changed.
   * `churnFrom` always fetches them; a hand-built input that omits them is
   * relying on the rows' own flag, which is what the tests do.
   */
  readonly approvals?: readonly Approval[];

  readonly window?: Window;

  /** What the window's `limit` excluded, so the result can admit to being partial. */
  readonly omittedRuns?: number;
  readonly omittedObservations?: number;
}

export function accumulateChurn(input: ChurnInput): Churn {
  const window = input.window ?? {};

  for (const row of input.observations) {
    if (row.component !== input.component) {
      throw new Error(
        `churn for \`${input.component}\` was given a row for \`${row.component}\`; ` +
          'rows must be filtered to one component, because a mixed slice inflates its rate',
      );
    }
    if (row.band === 'geometry' && !profileById(row.profile).layout) {
      // A geometry row from a tier with no layout engine cannot exist, so its
      // presence means something upstream wrote a zero where it should have
      // written nothing. Counting it would answer a geometry question with a
      // measurement nobody took.
      throw new Error(
        `a geometry row for \`${row.component}\` was recorded under \`${row.profile}\`, ` +
          'which has no layout engine and can never observe geometry',
      );
    }
  }

  const runIds = new Set<string>();
  const runIdsByProfile = new Map<ProfileId, Set<string>>();
  for (const run of input.runs) {
    runIds.add(run.run);
    const seen = runIdsByProfile.get(run.profile) ?? new Set<string>();
    seen.add(run.run);
    runIdsByProfile.set(run.profile, seen);
  }

  // Approved at write time, or approved later by somebody who reviewed it. The
  // two are one predicate on purpose: a caller that records acceptance inline and
  // a caller that records it afterwards must produce the same number, or the
  // meaning of a rate depends on which surface the operator happens to use.
  const accepted = new Set(
    (input.approvals ?? []).map((approval) => approvalKey(approval.subject, approval.run)),
  );
  const isApproved = (row: Observation): boolean =>
    row.accepted || accepted.has(approvalKey(row.subject, row.run));

  const approved = input.observations.filter(isApproved);
  const rejectedRuns = new Set(
    input.observations.filter((row) => !isApproved(row)).map((row) => row.run),
  );

  // Cause is decided per `(run, subject)` and without regard to the tier: the
  // question is whether this component's own code moved, and structure — the band
  // that answers it — means the same thing on every tier.
  const perRunSubject = new Map<string, Observation[]>();
  for (const row of approved) {
    const key = `${row.run}\u0000${row.subject}`;
    const group = perRunSubject.get(key) ?? [];
    group.push(row);
    perRunSubject.set(key, group);
  }

  const changedRunsByScope = new Map<string, Set<string>>();
  const causeRuns = new Set<string>();
  let firstAt: string | undefined;
  let lastAt: string | undefined;

  for (const group of perRunSubject.values()) {
    // `structure` or `style` moving is the component's own edit. `geometry` alone
    // is displacement. This is inference from the rows rather than a recorded
    // fact, and its one known blind spot is worth stating: under a tier that
    // resolves computed style, a parent's font-size change moves a child's
    // em-derived declarations, and that child is counted as a cause. Fixing it
    // needs a cause flag the recorded shape does not carry (spec 0002), and the
    // failure is in the direction of over-reporting an edit rather than hiding one.
    const cause = group.some((row) => row.band === 'structure' || row.band === 'style');
    if (!cause) continue;

    for (const row of group) {
      causeRuns.add(row.run);

      const scope = scopeOf(row.band, row.profile);
      const runsInScope = changedRunsByScope.get(scope) ?? new Set<string>();
      runsInScope.add(row.run);
      changedRunsByScope.set(scope, runsInScope);

      if (firstAt === undefined || instant(row.at) < instant(firstAt)) firstAt = row.at;
      if (lastAt === undefined || instant(row.at) > instant(lastAt)) lastAt = row.at;
    }
  }

  const runsWithRows = new Set(approved.map((row) => row.run));
  const collateralRuns = [...runsWithRows].filter((run) => !causeRuns.has(run)).length;

  const bands: BandChurn[] = [];
  const covered = new Set<string>();

  if (runIds.size > 0) {
    bands.push(bandChurn('structure', undefined, runIds.size, changedRunsByScope));
    covered.add(scopeOf('structure', 'jsdom'));
  }

  for (const profile of [...runIdsByProfile.keys()].sort()) {
    const runsUnderProfile = runIdsByProfile.get(profile)?.size ?? 0;
    if (runsUnderProfile === 0) continue;

    bands.push(bandChurn('style', profile, runsUnderProfile, changedRunsByScope));
    covered.add(scopeOf('style', profile));

    // A tier with no layout engine has no geometry denominator, so it gets no
    // geometry entry — rather than an entry reading `0 / n`, which would state
    // that nothing moved when the truth is that nothing looked.
    if (profileById(profile).layout) {
      bands.push(bandChurn('geometry', profile, runsUnderProfile, changedRunsByScope));
      covered.add(scopeOf('geometry', profile));
    }
  }

  for (const [scope, runs] of changedRunsByScope) {
    if (covered.has(scope)) continue;
    // Changes with no runs behind them means the runs slice is incomplete, and a
    // rate over a missing denominator is the inflated rate this whole file exists
    // to prevent. Refuse rather than divide.
    throw new Error(
      `\`${input.component}\` has ${runs.size} approved change(s) in scope ${scope}, ` +
        'but the window contains no run that could have observed it: the runs slice is incomplete',
    );
  }

  return {
    component: input.component,
    window,
    runs: runIds.size,
    changedRuns: causeRuns.size,
    bands,
    collateralRuns,
    rejectedRuns: rejectedRuns.size,
    ...(firstAt !== undefined ? { firstAt } : {}),
    ...(lastAt !== undefined ? { lastAt } : {}),
    omittedRuns: input.omittedRuns ?? 0,
    omittedObservations: input.omittedObservations ?? 0,
  };
}

function bandChurn(
  band: Band,
  profile: ProfileId | undefined,
  runs: number,
  changedRunsByScope: ReadonlyMap<string, ReadonlySet<string>>,
): BandChurn {
  // `structure` ignores the profile in its scope key, so any profile may be used
  // to build it; passing one here would suggest otherwise.
  const scope = scopeOf(band, profile ?? 'jsdom');
  const changes = changedRunsByScope.get(scope)?.size ?? 0;

  return {
    band,
    ...(profile !== undefined ? { profile } : {}),
    runs,
    changes,
    rate: changes / runs,
  };
}

/**
 * The scope a change is counted in.
 *
 * `structure` drops the profile — it is portable, so one edit seen by two tiers is
 * one change, and keeping the profile would count it twice and double the rate of
 * any project running both tiers. `style` and `geometry` keep it, because a value
 * observed by two tiers is two different observations of one page and comparing
 * them reports the tier rather than the edit.
 */
function scopeOf(band: Band, profile: ProfileId): string {
  return band === 'structure' ? 'structure' : `${band}/${profile}`;
}
