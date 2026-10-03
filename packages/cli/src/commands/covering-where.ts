/**
 * The cases that said a precondition, and the case one step from each.
 *
 * `--where network=mocked` keeps the cases whose rows say they arranged it. It
 * reads the record's precondition column and nothing else: a named
 * precondition is a state, nothing in a checkout changes it, so it narrows an
 * answer and never what a run would select.
 *
 * Where `names.axes` declares the name, the value is read on that axis the way
 * a subject's name is read: `values[0]` is the base, and a case that never said
 * the name stands at it. Reading a case on an axis, and finding its twin, is
 * `@variance-authority/sense`'s, where a subject's name is read; this file
 * reads the config and the flags, and prints.
 */

import { existsSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { join } from 'node:path';
import { keepCases } from './covering-scope.js';
import { parseNames } from '../config-names.js';
import { ConfigError, messageOf } from '../config-values.js';
import { said } from '../here.js';
import { DEFAULT_CONFIG } from '../usage.js';
import { OperatorError } from '../exit.js';
import {
  heldValues,
  outsideVocabulary,
  type CaseTwin,
  type ExecutionIndex,
  type ExecutionTest,
  type NameGrammar,
} from '@variance-authority/sense/test-selection';
import type { WhereCondition } from '../covering-args.js';
import type { Covering } from './covering.js';

type CasePrecondition = NonNullable<ExecutionTest['preconditions']>[number];

/** What `--where` kept, out of the cases that covered what was asked, and what it could not read. */
export interface CoveringWhere {
  /** The conditions, as given. */
  readonly asked: readonly string[];
  readonly kept: number;
  /** The cases that covered the line, function, file or change before `--where` narrowed them. */
  readonly of: number;
  /** Of those, cases on a row nobody listened to: whether they said any of it is unmeasured. */
  readonly unmeasured: number;
  /** Values a kept case said on a declared axis that the axis does not name. */
  readonly outside: readonly string[];
}

/**
 * The `names` grammar of the checkout the question is asked in, when it declares one.
 *
 * Only the section is read. `covering` answers before the rest of a config is
 * required, so a checkout whose config does not yet name a profile still
 * reads its axes.
 */
export async function namesAt(root: string): Promise<NameGrammar | undefined> {
  const path = join(root, DEFAULT_CONFIG);
  if (!existsSync(path)) return undefined;
  const source = said(path);
  let value: unknown;
  try {
    value = JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    throw new ConfigError(source, '(file)', `is not valid JSON: ${messageOf(error)}`);
  }
  const names = (value as { readonly names?: unknown } | null)?.names;
  return names === undefined ? undefined : parseNames(names, { source, baseDir: root });
}

/**
 * The index cut to the cases that said every condition.
 *
 * A record with no precondition column is refused as unmeasured rather than
 * answered with no case: an empty list would read as *nothing here mocks the
 * network*, which the record never measured.
 */
export function whereCases(
  index: ExecutionIndex,
  where: readonly WhereCondition[],
  names: NameGrammar | undefined,
): { readonly index: ExecutionIndex; readonly where: CoveringWhere } {
  const asked = where.map((condition) => condition.value === undefined ? condition.name : `${condition.name}=${condition.value}`);
  const unmeasured = index.tests.filter((test) => test.preconditions === undefined).length;
  if (index.tests.length > 0 && unmeasured === index.tests.length) {
    throw new OperatorError(
      `\`--where ${asked.join(' --where ')}\` is unmeasured here: the record holds no case's preconditions. ` +
        'It was made before cases said what they arranged, or by a runner that did not listen. ' +
        'Record the suite again to read them.',
      { kind: 'unmeasured' },
    );
  }
  const kept = index.tests.filter((test) => test.preconditions !== undefined
    && where.every((condition) => holds(test.preconditions!, condition, names)));
  return {
    index: keepCases(index, new Set(kept.map((test) => test.id))),
    where: { asked, kept: kept.length, of: index.tests.length, unmeasured, outside: outside(kept, names) },
  };
}

function holds(said: readonly CasePrecondition[], condition: WhereCondition, names: NameGrammar | undefined): boolean {
  const values = heldValues(said, condition.name, names);
  return condition.value === undefined ? values.length > 0 : values.includes(condition.value);
}

function outside(kept: readonly ExecutionTest[], names: NameGrammar | undefined): readonly string[] {
  const notes = new Set<string>();
  for (const test of kept) {
    for (const off of outsideVocabulary(test.preconditions ?? [], names)) {
      notes.add(`${off.axis}=${off.value} (${off.site}) is not one of ${off.values.join(', ')}`);
    }
  }
  return [...notes];
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
  names: NameGrammar | undefined,
): CoveringWhere {
  return {
    asked: where.asked,
    kept: kept.length,
    of: reached.length,
    unmeasured: reached.filter((test) => test.preconditions === undefined).length,
    outside: outside(kept, names),
  };
}

/**
 * What a case said, with the call that said it: `flag=ff-on (spec.ts:9)`. A
 * name said twice at one level is printed as the contradiction it is.
 */
export function heldText(said: readonly CasePrecondition[] | undefined): string {
  if (said === undefined || said.length === 0) return '';
  const byName = new Map<string, CasePrecondition[]>();
  for (const held of said) byName.set(held.name, [...byName.get(held.name) ?? [], held]);
  return ` — ${[...byName].map(([name, held]) => held.length === 1
    ? `${valued(held[0]!)} (${held[0]!.site})`
    : `${name} contradicted: ${held.map((one) => `${String(one.value)} (${one.site})`).join(', ')}`,
  ).join(', ')}`;
}

/** One thing a case said: `flag=ff-on`, or the bare name for `true`. */
export function valued(held: CasePrecondition): string {
  return held.value === true ? held.name : `${held.name}=${String(held.value)}`;
}

/** Names a twin line prints before it says how many more there are. */
const TWINS_NAMED = 3;

/** The line a twin prints under its case: a few names, and a count when there are more. */
export function twinText(twin: CaseTwin, nameOf: (id: string) => string, indent: string): string {
  const at = `${twin.axis}=${twin.to}`;
  if (twin.twins.length === 0) return `${indent}no twin recorded at ${at}`;
  const named = twin.twins.slice(0, TWINS_NAMED).map(nameOf);
  const more = twin.twins.length - named.length;
  const names = `${named.join(', ')}${more === 0 ? '' : `, and ${more} more`}`;
  return twin.twins.length === 1 ? `${indent}twin at ${at}: ${names}` : `${indent}${twin.twins.length} twins at ${at}: ${names}`;
}

/** What `--where` kept, said before the cases it kept. */
/** A case's name from its id, `file > name`; an id with no file part is its own name. */
export function caseNameOf(id: string): string {
  const at = id.indexOf(' > ');
  return at === -1 ? id : id.slice(at + 3);
}

/**
 * Over text the record cannot place, a file answer lists no case, and *none
 * covered it* would be a claim the record never made. A function is still found
 * by name there, and its cases are listed and counted.
 */
export function placesNoCase(answer: Pick<Covering, 'frame' | 'tests'>): boolean {
  return answer.frame === 'stale' && answer.tests === undefined;
}

export function whereText(answer: Covering): readonly string[] {
  const where = answer.where;
  if (where === undefined || placesNoCase(answer)) return [];
  const asked = where.asked.join(' and ');
  const target = coveredText(answer);
  const cases = `case${where.of === 1 ? '' : 's'}`;
  return [
    where.of === 0
      ? `No case covered ${target}, so none said ${asked}.`
      : where.kept === 0
        ? `Kept none of the ${where.of} ${cases} that covered ${target}: ${noneSaid(where, asked)}.`
        : `Kept the ${where.kept} of ${where.of} ${cases} that covered ${target} and said ${asked}.`,
    ...where.unmeasured === 0 ? [] : [
      `${where.unmeasured} case${where.unmeasured === 1 ? ' was' : 's were'} not listened to, so whether ${
        where.unmeasured === 1 ? 'it' : 'they'
      } said any of that is unmeasured.`,
    ],
    ...where.outside.map((note) => `  ${note}`),
  ];
}

/** *None said it* is claimed only of the cases that were listened to; the rest are counted apart. */
function noneSaid(where: CoveringWhere, asked: string): string {
  if (where.unmeasured === 0) return `none said ${asked}`;
  const heard = where.of - where.unmeasured;
  return heard === 0 ? 'none of them was listened to' : `none of the ${heard} listened to said ${asked}`;
}

/** What the question asked about, as the count names it. */
function coveredText(answer: Covering): string {
  if (answer.changed !== undefined) return answer.since === undefined ? 'the change' : `the change since ${answer.since}`;
  const target = answer.target;
  if (target === undefined) return answer.file ?? '';
  return `${'line' in target ? `line ${target.line}` : `function ${target.function}`} of ${answer.file ?? ''}`;
}
