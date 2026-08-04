import type { Band, Observation } from './observation.js';
import type { Churn, Reach } from './store.js';
import type { TokenDrift } from './token-drift.js';

/**
 * The numbers, said out loud.
 *
 * Separate from the arithmetic that produces them because it is a different kind
 * of decision and fails in a different way. A wrong number is a defect in
 * `churn.ts` or `token-drift.ts`; a correct number in a sentence that reads as a
 * finding when it is not — "changed in 4 of 4 runs", "no change" over a truncated
 * slice — is a defect here, and it is invisible to any test of the arithmetic.
 * Every function below therefore takes a finished result and adds nothing to it:
 * whatever the window excluded is stated rather than quietly dropped, and no
 * fraction is reduced to a bare percentage on the way out.
 */

/**
 * Churn as one sentence.
 *
 * The audience is a reviewer deciding whether to look and an agent deciding
 * whether to act. Both are worse served by a table than by a line, and both are
 * badly served by a bare percentage — so the fraction stays visible, the
 * collateral is named as collateral rather than hidden, and anything the window
 * excluded is stated instead of quietly lowering the number.
 */
export function describeChurn(churn: Churn): string {
  if (churn.runs === 0) {
    return (
      `no runs are recorded in this window, so how often \`${churn.component}\` changes ` +
      'is unanswerable here — this is not the same as it having been stable'
    );
  }

  const head =
    `\`${churn.component}\` caused an approved change in ${churn.changedRuns} of ` +
    `${churn.runs} run(s) (${percent(churn.changedRuns / churn.runs)})`;

  const perBand = churn.bands
    .filter((band) => band.changes > 0)
    .map(
      (band) =>
        `${band.band} ${band.changes}/${band.runs}` +
        (band.profile !== undefined ? ` under ${band.profile}` : ' across every tier'),
    );

  const clauses = [
    perBand.length > 0 ? `: ${perBand.join(', ')}` : '',
    churn.lastAt !== undefined ? `; last on ${churn.lastAt}` : '',
    churn.collateralRuns > 0
      ? `; ${churn.collateralRuns} further run(s) moved only its geometry — displaced by an edit ` +
        'elsewhere, and not counted'
      : '',
    churn.rejectedRuns > 0
      ? `; ${churn.rejectedRuns} run(s) recorded a rejected change, which drift never sums`
      : '',
    churn.omittedRuns > 0 || churn.omittedObservations > 0
      ? `; the window's limit excluded ${churn.omittedRuns} run(s) and ` +
        `${churn.omittedObservations} row(s), so this rate is computed over part of the window`
      : '',
  ];

  return head + clauses.join('');
}

/**
 * A token journey as one sentence.
 *
 * Built around the largest single step, because that number is the argument. A
 * total of 8px is unremarkable; a total of 8px whose largest step was 2px says
 * that no per-change review could ever have seen it, and that is the finding the
 * store was built to produce.
 */
export function describeDrift(drift: TokenDrift): string {
  const span = `${drift.firstAt} → ${drift.lastAt}`;
  const at = drift.incomplete ? 'at least ' : '';

  if (drift.steps.length === 0) {
    // Only reachable when the limit excluded values: a complete journey with no
    // steps is `null`, not a finding. Saying "no change" here would convert a
    // truncated slice into a claim of stability.
    return (
      `\`${drift.token}\` shows no value change in the part of the window that was returned ` +
      `(${drift.readings} reading(s), ${span}), but the limit excluded ${drift.omitted} ` +
      'further value(s) — nothing here rules out drift'
    );
  }

  if (drift.quantity === undefined) {
    const reason = drift.unquantifiable ?? 'the values are not quantities';
    return (
      `\`${drift.token}\` changed ${at}${drift.steps.length} time(s) over ${span}, ` +
      `${drift.from} → ${drift.to}; ${reason}, so the size of the drift is not measurable — ` +
      'only its count' +
      incompleteClause(drift)
    );
  }

  const { unit, net, largestStep, travel } = drift.quantity;

  if (travel === 0) {
    return (
      `\`${drift.token}\` was rewritten ${drift.steps.length} time(s) without moving ` +
      `(${drift.from} → ${drift.to}) over ${span}` +
      incompleteClause(drift)
    );
  }

  const movement =
    net === 0 && travel > 0
      ? `returned to ${drift.to} after ${at}${number(travel)}${unit} of movement`
      : `drifted ${drift.from} → ${drift.to}, ${at}${number(Math.abs(net))}${unit}`;

  const verdict = drift.notable
    ? `the largest single step was ${number(largestStep)}${unit}, so no per-change review ` +
      'could have seen the total'
    : `the largest single step was ${number(largestStep)}${unit} of that, so it was ` +
      'reviewable as one change';

  return (
    `\`${drift.token}\` ${movement} across ${at}${drift.steps.length} approved commit(s) ` +
    `(${span}); ${verdict}` +
    incompleteClause(drift)
  );
}

/**
 * Reach as one sentence.
 *
 * `arrived` leads, because it is the part a single run cannot see. A component
 * appearing in forty subjects is a fact about the codebase; a component that
 * appeared in seven of them for the first time this quarter is a change somebody
 * made and nobody reviewed as one.
 */
export function describeReach(reach: Reach): string {
  if (reach.subjects.length === 0 && reach.omittedSubjects === 0) {
    return `\`${reach.component}\` was not observed in any subject in this window`;
  }

  const sample = reach.arrived.slice(0, 3);
  const rest = reach.arrived.length - sample.length;

  const arrived =
    reach.arrived.length === 0
      ? '; it appeared in none of them for the first time'
      : `; ${reach.arrived.length} of them saw it for the first time in this window: ` +
        sample.join(', ') +
        (rest > 0 ? ` (+${rest} more)` : '');

  const omitted =
    reach.omittedSubjects > 0
      ? `; the window's limit excluded ${reach.omittedSubjects} further subject(s)`
      : '';

  return (
    `\`${reach.component}\` appears in ${reach.subjects.length} subject(s) in this window` +
    arrived +
    omitted
  );
}

/**
 * The last recorded change to an area, as one sentence.
 *
 * `null` gets its own sentence rather than an empty string. "Nothing was ever
 * recorded here" is a real answer from a store that has been keeping a record,
 * and it has to be visibly different from the store not existing — which is what
 * an `Unkept` answer says instead.
 */
export function describeLastChanged(
  subject: string,
  component: string,
  observation: Observation | null,
  band?: Band,
): string {
  const area = `\`${component}\` in \`${subject}\`${band !== undefined ? ` (${band})` : ''}`;

  if (observation === null) {
    return `${area} has never been recorded as changing; the record exists and does not contain it`;
  }

  return (
    `${area} last changed on ${observation.at} in its ${observation.band} band — ` +
    `commit ${observation.commit}, run ${observation.run}, observed by ${observation.profile}, ` +
    `${observation.accepted ? 'approved' : 'rejected'}` +
    (observation.file !== undefined ? ` — ${observation.file}` : '')
  );
}

function incompleteClause(drift: TokenDrift): string {
  return drift.incomplete
    ? `; the window's limit excluded ${drift.omitted} further value(s), so every total here ` +
        'is a lower bound'
    : '';
}

/** Display rounding of a computed float. `0.1 + 0.2` must not reach a sentence. */
function number(value: number): string {
  return String(Number(value.toFixed(4)));
}

function percent(rate: number): string {
  return `${Number((rate * 100).toFixed(1))}%`;
}
