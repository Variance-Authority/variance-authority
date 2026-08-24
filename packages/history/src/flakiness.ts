import { instant } from './instant.js';
import type { Instability } from './instability.js';
import type { RunRecord } from './observation.js';
import type { Flakiness, FlakyCause, Window } from './store.js';

/**
 * How often a subject has failed to read the same way twice, over a window.
 *
 * Pure and synchronous, for the reason `churn.ts` is: these numbers decide
 * whether somebody spends a day on a fixture or dismisses a finding, and every
 * way of getting them wrong is a way of being confidently wrong.
 *
 * Three rules do the work here, and each of them is the difference between a
 * measurement and a number that merely looks like one.
 *
 * **A rate needs a denominator that was actually asked.** A normal run reads a
 * subject twice only once the comparison called it `changed`. So a subject that
 * was green in eighteen runs was never asked whether it agrees with itself, and
 * dividing occurrences by *runs* would report a flake that fires every single
 * time it is examined as firing one run in ten. The denominator is therefore
 * **sweeps** — runs that read every subject twice — and when no sweep has run,
 * there is no rate at all. Absent, not zero.
 *
 * **Recency is the actionable half.** "Unstable in 6 of 20" says a fixture is bad;
 * "unstable 6 times, none in the last 9 sweeps" says somebody already fixed it,
 * and those are opposite instructions. `sweepsSince` is the second number, and it
 * is counted in sweeps for the same reason the rate is.
 *
 * **An absorbed occurrence is counted and kept apart.** A route that declared it
 * asserts on layout is not lying when its clock ticks: that instability never
 * gates and is never a finding. It is still recorded, because a rule that has
 * absorbed something in every run for six months is worth being able to ask
 * about — a declaration nobody re-reads is how a suite quietly stops watching
 * something.
 */

export interface FlakinessInput {
  readonly subject: string;

  /**
   * Every run in the window, quiet ones included. One entry per `(run, profile)`,
   * as elsewhere; the arithmetic counts distinct run ids where the question does
   * not depend on the tier.
   */
  readonly runs: readonly RunRecord[];

  /** Every instability row recorded for this subject in the window. */
  readonly occurrences: readonly Instability[];

  readonly window?: Window;

  /** What the window's `limit` excluded, so the answer can admit to being partial. */
  readonly omittedRuns?: number;
  readonly omittedOccurrences?: number;
}

export function accumulateFlakiness(input: FlakinessInput): Flakiness {
  const window = input.window ?? {};

  for (const row of input.occurrences) {
    if (row.subject !== input.subject) {
      throw new Error(
        `flakiness for \`${input.subject}\` was given a row for \`${row.subject}\`; ` +
          'rows must be filtered to one subject, because a mixed slice invents a flake',
      );
    }
  }

  const runIds = new Set(input.runs.map((run) => run.run));
  // A run counts as a sweep when *any* of its profile records says it swept. Two
  // tiers of one run are one examination of the suite from the perspective of
  // "was this subject asked", and requiring both would undercount a project that
  // sweeps under one tier and compares under the other.
  const sweptIds = new Set(input.runs.filter((run) => run.swept === true).map((run) => run.run));

  const fired = new Set<string>();
  const absorbed = new Set<string>();
  const causes = new Map<string, { readonly cause: FlakyCause; runs: Set<string> }>();

  let firstAt: string | undefined;
  let lastAt: string | undefined;
  let lastRun: string | undefined;
  let lastAtMs = Number.NEGATIVE_INFINITY;

  for (const row of input.occurrences) {
    // A row whose run was excluded by the window's limit is dropped from every
    // count rather than added to one, and reported as omitted by the caller. The
    // alternative is an occurrence whose denominator is missing, which is a rate
    // above its true value in the alarming direction.
    if (!runIds.has(row.run)) continue;

    if (row.absorbedBy === undefined) fired.add(row.run);
    else absorbed.add(row.run);

    const key = `${row.component ?? ''}\u0000${row.band ?? ''}`;
    const held = causes.get(key);
    if (held === undefined) {
      causes.set(key, {
        cause: {
          ...(row.component !== undefined ? { component: row.component } : {}),
          ...(row.band !== undefined ? { band: row.band } : {}),
          runs: 0,
        },
        runs: new Set([row.run]),
      });
    } else {
      held.runs.add(row.run);
    }

    const at = instant(row.at);
    if (firstAt === undefined || at < instant(firstAt)) firstAt = row.at;
    if (at > lastAtMs) {
      lastAtMs = at;
      lastAt = row.at;
      lastRun = row.run;
    }
  }

  // Sweeps that happened *after* the last occurrence. Counted from the run
  // records rather than from the gap between timestamps, because "nine sweeps
  // have not seen it since" is a statement about examinations and "three weeks"
  // is a statement about the calendar — and a suite that stopped running would
  // otherwise look increasingly fixed the longer nobody looked.
  const sweepsSince =
    lastAtMs === Number.NEGATIVE_INFINITY
      ? sweptIds.size
      : new Set(
          input.runs
            .filter((run) => run.swept === true && instant(run.at) > lastAtMs)
            .map((run) => run.run),
        ).size;

  const sweptOccurrences = new Set([...fired, ...absorbed].filter((run) => sweptIds.has(run)));

  return {
    subject: input.subject,
    window,
    runs: runIds.size,
    sweeps: sweptIds.size,
    occurrences: fired.size,
    absorbedRuns: absorbed.size,
    // Absent, never zero, when nothing has ever swept: a rate over a denominator
    // nobody asked is the "confident answer to a question that was never asked"
    // this whole package is arranged to refuse.
    ...(sweptIds.size > 0 ? { rate: sweptOccurrences.size / sweptIds.size } : {}),
    sweepsSince,
    causes: [...causes.values()]
      .map((entry) => ({ ...entry.cause, runs: entry.runs.size }))
      .sort((left, right) => {
        const byRuns = right.runs - left.runs;
        if (byRuns !== 0) return byRuns;
        const leftLabel = label(left);
        const rightLabel = label(right);
        return leftLabel < rightLabel ? -1 : leftLabel > rightLabel ? 1 : 0;
      }),
    ...(firstAt !== undefined ? { firstAt } : {}),
    ...(lastAt !== undefined ? { lastAt } : {}),
    ...(lastRun !== undefined ? { lastRun } : {}),
    omittedRuns: input.omittedRuns ?? 0,
    omittedOccurrences: input.omittedOccurrences ?? 0,
  };
}

function label(cause: FlakyCause): string {
  return `${cause.component ?? ''} ${cause.band ?? ''}`;
}

/**
 * The one sentence a report, a comment or an agent prints under a finding.
 *
 * Written here rather than at each surface because there are four of them and the
 * distinction they must not lose is subtle: an absent record, a record with
 * nothing in it, and a record that says this stopped happening are three
 * different instructions to whoever reads them.
 */
export function describeFlakiness(flakiness: Flakiness): string {
  const { occurrences, absorbedRuns, sweeps, sweepsSince, rate } = flakiness;

  if (occurrences === 0 && absorbedRuns === 0) {
    return sweeps === 0
      ? 'no sweep has ever read every subject twice in this window, so nothing here has been ' +
          'asked whether it agrees with itself — this is silence, not stability'
      : `not seen to read differently in ${sweeps} sweep(s) of this window`;
  }

  const share =
    rate === undefined
      ? `${occurrences} run(s) — no sweep in this window, so there is no rate to divide by`
      : `${occurrences} run(s), ${Math.round(rate * 100)}% of the ${sweeps} sweep(s) that asked`;

  const since =
    sweepsSince === 0
      ? 'and the most recent sweep still saw it'
      : `and ${sweepsSince} sweep(s) have not seen it since`;

  const declared =
    absorbedRuns === 0
      ? ''
      : `. A further ${absorbedRuns} run(s) read differently entirely in bands this subject does ` +
        'not assert on, which is working as declared and is counted separately';

  return `read differently in ${share}, ${since}${declared}`;
}
