/**
 * The cases that said a precondition, and the cases whose code read a value.
 *
 * `--where network=mocked` keeps the cases whose rows say they arranged it, and
 * `--read flags:checkout=true` the cases whose code read it. Each reads its own
 * facet of the record's column and nothing else: what a case said and what its
 * code read are states, nothing in a checkout changes them, so they narrow an
 * answer and never what a run would select.
 */

import { keepCases } from './covering-scope.js';
import {
  heldValues,
  readsOf,
  rowOf,
  type CasePrecondition,
  type ExecutionIndex,
  type ExecutionTest,
} from '@variance-authority/sense/test-selection';
import type { WhereCondition } from '../covering-args.js';
import { targetText } from './covering-at.js';
import type { Covering } from './covering.js';

/** What `--where` and `--read` kept, out of the cases that covered what was asked, and what they could not read. */
export interface CoveringWhere {
  /** The `--where` conditions, as given. */
  readonly asked: readonly string[];
  /** The `--read` conditions, as given; absent when none was. */
  readonly read?: readonly string[];
  readonly kept: number;
  /** The cases that covered the line, function, file or change before `--where` narrowed them. */
  readonly of: number;
  /** Of those, cases on a row nobody listened to for a facet asked about: whether they said or read any of it is unmeasured. */
  readonly unmeasured: number;
}

/**
 * The index cut to the cases that said every `--where` condition and whose
 * code read every `--read` one.
 *
 * A case on a row with no column for a facet asked about is kept by no
 * condition and counted as unmeasured, so a record made before cases said
 * anything answers that every case is unmeasured rather than *nothing here
 * mocks the network*, which the record never measured.
 */
export function whereCases(
  index: ExecutionIndex,
  where: readonly WhereCondition[],
  read: readonly WhereCondition[],
): { readonly index: ExecutionIndex; readonly where: CoveringWhere } {
  const kept = index.tests.filter((test) => {
    const said = rowOf(test);
    const reads = readsOf(test);
    return (where.length === 0 || (said !== undefined && where.every((condition) => holds(said, condition))))
      && (read.length === 0 || (reads !== undefined && read.every((condition) => holds(reads, condition))));
  });
  const asked = { asked: where.map(spelling), ...(read.length === 0 ? {} : { read: read.map(spelling) }) };
  return {
    index: keepCases(index, new Set(kept.map((test) => test.id))),
    where: { ...asked, kept: kept.length, of: index.tests.length, unmeasured: unheard(asked, index.tests) },
  };
}

function spelling(condition: WhereCondition): string {
  return condition.value === undefined ? condition.name : `${condition.name}=${condition.value}`;
}

function holds(said: readonly CasePrecondition[], condition: WhereCondition): boolean {
  const values = heldValues(said, condition.name);
  return condition.value === undefined ? values.length > 0 : values.includes(condition.value);
}

/** The cases nobody listened to for a facet the conditions ask about. */
function unheard(where: Pick<CoveringWhere, 'asked' | 'read'>, tests: readonly ExecutionTest[]): number {
  return tests.filter((test) =>
    (where.asked.length > 0 && rowOf(test) === undefined) || (where.read !== undefined && readsOf(test) === undefined)).length;
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
  return { ...where, kept: kept.length, of: reached.length, unmeasured: unheard(where, reached) };
}

/** What `--where` and `--read` kept, said before the cases they kept. */
export function whereText(answer: Covering): readonly string[] {
  const where = answer.where;
  if (where === undefined) return [];
  const asked = askedText(where);
  const target = coveredText(answer);
  const cases = `case${where.of === 1 ? '' : 's'}`;
  return [
    where.of === 0
      ? `No case covered ${target}, so none ${asked}.`
      : where.kept === 0
        ? `Kept none of the ${where.of} ${cases} that covered ${target}: ${noneSaid(where, asked)}.`
        : `Kept the ${where.kept} of ${where.of} ${cases} that covered ${target} and ${asked}.`,
    ...where.unmeasured === 0 ? [] : [
      `${where.unmeasured} case${where.unmeasured === 1 ? ' was' : 's were'} recorded without ${facets(where)}, so whether ${
        where.unmeasured === 1 ? 'it' : 'they'
      } ran under any of that is unmeasured.`,
    ],
  ];
}

/** `recorded network:api=mocked and read flags:checkout=true`: what a kept case did, by facet. */
function askedText(where: CoveringWhere): string {
  return [
    ...where.asked.length === 0 ? [] : [`recorded ${where.asked.join(' and ')}`],
    ...where.read === undefined ? [] : [`read ${where.read.join(' and ')}`],
  ].join(' and ');
}

/** The facets the conditions ask about, as a record would lack them. */
function facets(where: CoveringWhere): string {
  return [...where.asked.length === 0 ? [] : ['preconditions'], ...where.read === undefined ? [] : ['reads']].join(' or ');
}

/** *None said it* is claimed only of the cases that were listened to; the rest are counted apart. */
function noneSaid(where: CoveringWhere, asked: string): string {
  if (where.unmeasured === 0) return `none ${asked}`;
  const heard = where.of - where.unmeasured;
  if (heard === 0) return `none of them was recorded with ${facets(where).replace(' or ', ' and ')}`;
  // Spec 0093's sentence for `--where` alone: a case with recorded preconditions *has* a value.
  const what = where.read === undefined ? `has ${where.asked.join(' and ')}` : asked;
  return `none of the ${heard} with recorded ${facets(where).replace(' or ', ' and ')} ${what}`;
}

/** What the question asked about, as the count names it. */
function coveredText(answer: Covering): string {
  if (answer.changed !== undefined) return answer.since === undefined ? 'the change' : `the change since ${answer.since}`;
  const target = answer.target;
  // Over text the record cannot place, the cases are the ones that ran code in the file, not on the line asked.
  if (target === undefined || (answer.frame === 'stale' && !('function' in target))) return answer.file ?? '';
  return `${targetText(target)} of ${answer.file ?? ''}`;
}
