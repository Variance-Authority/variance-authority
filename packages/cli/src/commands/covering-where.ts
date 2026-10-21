/**
 * The cases that said a precondition.
 *
 * `--where network=mocked` keeps the cases whose rows say they arranged it. It
 * reads the record's precondition column and nothing else: a named
 * precondition is a state, nothing in a checkout changes it, so it narrows an
 * answer and never what a run would select.
 */

import { keepCases } from './covering-scope.js';
import {
  heldValues,
  rowOf,
  type CasePrecondition,
  type ExecutionIndex,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import type { WhereCondition } from '../covering-args.js';
import { targetText } from './covering-at.js';
import type { Covering } from './covering.js';

/** What `--where` kept, out of the cases that covered what was asked, and what it could not read. */
export interface CoveringWhere {
  /** The conditions, as given. */
  readonly asked: readonly string[];
  readonly kept: number;
  /** The cases that covered the line, function, file or change before `--where` narrowed them. */
  readonly of: number;
  /** Of those, cases on a row nobody listened to: whether they said any of it is unmeasured. */
  readonly unmeasured: number;
}

/**
 * The index cut to the cases that said every condition.
 *
 * A case on a row with no precondition column is kept by no condition and
 * counted as unmeasured, so a record made before cases said anything answers
 * that every case is unmeasured rather than *nothing here mocks the network*,
 * which the record never measured.
 */
export function whereCases(
  index: ExecutionIndex,
  where: readonly WhereCondition[],
): { readonly index: ExecutionIndex; readonly where: CoveringWhere } {
  const asked = where.map((condition) => condition.value === undefined ? condition.name : `${condition.name}=${condition.value}`);
  const unmeasured = index.tests.filter((test) => test.said === undefined).length;
  const kept = index.tests.filter((test) => {
    const row = rowOf(test);
    return row !== undefined && where.every((condition) => holds(row, condition));
  });
  return {
    index: keepCases(index, new Set(kept.map((test) => test.id))),
    where: { asked, kept: kept.length, of: index.tests.length, unmeasured },
  };
}

function holds(said: readonly CasePrecondition[], condition: WhereCondition): boolean {
  const values = heldValues(said, condition.name);
  return condition.value === undefined ? values.length > 0 : values.includes(condition.value);
}

/**
 * Every case an answer lists, once: on the line or function, in a range of the
 * file, in a changed region, or declared by a changed test file.
 */
export function listedIn(answer: {
  readonly tests?: readonly ExecutionTest[];
  readonly ranges?: readonly { readonly tests: readonly ExecutionTest[] }[];
  readonly changed?: readonly {
    readonly regions: readonly { readonly tests: readonly ExecutionTest[] }[];
    readonly cases: readonly ExecutionTest[];
  }[];
}): readonly ExecutionTest[] {
  const every = [
    ...answer.tests ?? [],
    ...(answer.ranges ?? []).flatMap((range) => range.tests),
    ...(answer.changed ?? []).flatMap((file) => [...file.regions.flatMap((region) => region.tests), ...file.cases]),
  ];
  return [...new Map(every.map((test) => [test.id, test])).values()];
}

/**
 * What `--where` kept, counted against what the question reached: the cases
 * that covered the line, function, file or change, before `--where` narrowed
 * them. A count against the whole record would say how many cases a suite
 * has, which is not what was asked.
 */
export function whereOver(
  where: CoveringWhere,
  kept: readonly ExecutionTest[],
  reached: readonly ExecutionTest[],
): CoveringWhere {
  return {
    asked: where.asked,
    kept: kept.length,
    of: reached.length,
    unmeasured: reached.filter((test) => test.said === undefined).length,
  };
}

/** What `--where` kept, said before the cases it kept. */
export function whereText(answer: Covering): readonly string[] {
  const where = answer.where;
  if (where === undefined) return [];
  const asked = where.asked.join(' and ');
  const target = coveredText(answer);
  const cases = `case${where.of === 1 ? '' : 's'}`;
  return [
    where.of === 0
      ? `No case covered ${target}, so none recorded ${asked}.`
      : where.kept === 0
        ? `Kept none of the ${where.of} ${cases} that covered ${target}: ${noneSaid(where, asked)}.`
        : `Kept the ${where.kept} of ${where.of} ${cases} that covered ${target} and recorded ${asked}.`,
    ...where.unmeasured === 0 ? [] : [
      `${where.unmeasured} case${where.unmeasured === 1 ? ' was' : 's were'} recorded without preconditions, so whether ${
        where.unmeasured === 1 ? 'it' : 'they'
      } ran under any of that is unmeasured.`,
    ],
  ];
}

/** *None said it* is claimed only of the cases that were listened to; the rest are counted apart. */
function noneSaid(where: CoveringWhere, asked: string): string {
  if (where.unmeasured === 0) return `none recorded ${asked}`;
  const heard = where.of - where.unmeasured;
  return heard === 0 ? 'none of them was recorded with preconditions' : `none of the ${heard} with recorded preconditions has ${asked}`;
}

/** What the question asked about, as the count names it. */
function coveredText(answer: Covering): string {
  if (answer.changed !== undefined) return answer.since === undefined ? 'the change' : `the change since ${answer.since}`;
  const target = answer.target;
  // Over text the record cannot place, the cases are the ones that ran code in the file, not on the line asked.
  if (target === undefined || (answer.frame === 'stale' && !('function' in target))) return answer.file ?? '';
  return `${targetText(target)} of ${answer.file ?? ''}`;
}
