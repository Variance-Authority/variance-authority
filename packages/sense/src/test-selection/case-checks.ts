/**
 * A run's checks section, from the cases it ran: what each case's body
 * declares, read from its test file, beside what each attempt entered, told by
 * the case scope. Every runner hands the same three things — its cases, how
 * each attempt ended, and the checks each attempt's scope was told of — so one
 * builder serves the Vitest, Jest and Rstest fold and the Playwright recording.
 *
 * The declaration is read from source and never from the run: the set a run is
 * judged against exists before it, outside the results it is compared with.
 *
 * A file is incomplete when its runner did not end an attempt it began there: an
 * attempt with no ending, one before the last that has no row, or one the runner
 * interrupted. Its cases are not judged, because an attempt cut short may have
 * passed what it reached and been stopped before a check. It is read from the
 * attempts and not from whether the file's coverage is whole: a case that failed,
 * or a retry that passed after it, ended, and leaves the other cases of its file
 * to be judged.
 */

// compass: variance-authority.reach

import { codeUnitOrder } from '@variance-authority/core/segment';
import { native } from '../addon.js';
import type { ObservedAttempt } from './attempts-record.js';
import type { CheckedAttempt, CheckedCase, ChecksSection } from './checks-record.js';

/** A check an attempt's case scope was told it entered. */
export interface EnteredCheck {
  readonly attempt: number;
  readonly check: string;
}

/** A case a run ran, as its runner and its case scope tell it. */
export interface RanCase {
  /** The test file, from `root`. */
  readonly file: string;
  readonly name: string;
  readonly project?: string;
  /** How each attempt ended, as the runner reported it; absent where it reported none. */
  readonly attempts: readonly Pick<ObservedAttempt, 'attempt' | 'ended'>[] | undefined;
  readonly entered: readonly EnteredCheck[];
}

/**
 * The checks section of a run that ran `cases` over `tests`, or `undefined`
 * when none of its cases declares a check the source spells, or the addon that
 * reads the declarations is not loaded: such a run kept no checks, which is not
 * a run that missed none.
 *
 * A case's attempts are those its runner reported and those its scope told of a
 * check under; an attempt the runner did not report has no ending, and is not
 * judged. A check the case does not declare is not kept: it is not read from
 * the source, so nothing could be missing of it.
 */
export function checksOf(root: string, cases: readonly RanCase[]): ChecksSection | undefined {
  const declared = native()?.declaredChecks?.(root, cases.map(({ file, name }) => ({ file, name })));
  if (declared === undefined) return undefined;
  const checked = cases.flatMap((ran, at): CheckedCase[] => {
    const body = declared[at];
    return body == null ? [] : [{
      file: ran.file,
      line: body.line,
      name: ran.name,
      ...(ran.project === undefined ? {} : { project: ran.project }),
      declared: body.checks,
      attempts: attemptsOf(ran, new Set(body.checks.map((check) => check.id))),
    }];
  });
  if (checked.length === 0) return undefined;
  checked.sort((left, right) => codeUnitOrder(left.file, right.file) || left.line - right.line || codeUnitOrder(left.name, right.name));
  // Every case the run ran says whether its file ended, not only the judged ones.
  const judged = new Set(checked.map((one) => one.file));
  const cut = cases.filter((ran) => judged.has(ran.file) && !endedAll(attemptsOf(ran, new Set())));
  return { incomplete: [...new Set(cut.map((ran) => ran.file))].sort(codeUnitOrder), cases: checked };
}

function attemptsOf(ran: RanCase, ids: ReadonlySet<string>): CheckedAttempt[] {
  const ended = new Map((ran.attempts ?? []).map((one) => [one.attempt, one.ended]));
  const numbers = new Set([...ended.keys(), ...ran.entered.map((one) => one.attempt)]);
  return [...numbers].sort((left, right) => left - right).map((attempt) => {
    const end = ended.get(attempt);
    const entered = ran.entered.filter((one) => one.attempt === attempt && ids.has(one.check)).map((one) => one.check);
    return { attempt, ...(end === undefined ? {} : { ended: end }), entered: [...new Set(entered)].sort(codeUnitOrder) };
  });
}

/** Whether the runner ended every attempt `attempts` holds and every one before the last. */
function endedAll(attempts: readonly CheckedAttempt[]): boolean {
  return attempts.length === (attempts.at(-1)?.attempt ?? 0)
    && attempts.every((one) => one.ended !== undefined && one.ended !== 'interrupted');
}
