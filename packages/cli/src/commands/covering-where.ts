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
import { preconditionText } from '@variance-authority/sense/journal';
import {
  heldValues,
  outsideVocabulary,
  type CaseTwin,
  type ExecutionIndex,
  type ExecutionTest,
  type NameGrammar,
} from '@variance-authority/sense/test-selection';
import type { WhereCondition } from '../covering-args.js';

type CasePrecondition = NonNullable<ExecutionTest['preconditions']>[number];

/** What `--where` kept, out of how many, and what it could not read. */
export interface CoveringWhere {
  /** The conditions, as given. */
  readonly asked: readonly string[];
  readonly kept: number;
  readonly of: number;
  /** Under a line or function question: how many named tests covered it before `--where` narrowed them. */
  readonly ran?: number;
  /** Cases on a row nobody listened to: whether they said any of it is unmeasured. */
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

/** What a case said, after its name, or nothing when it said nothing. */
export function heldText(said: readonly CasePrecondition[] | undefined): string {
  return said === undefined || said.length === 0 ? '' : ` — ${preconditionText(said)}`;
}

/** The lines a twin prints under its case. */
export function twinText(twin: CaseTwin, nameOf: (id: string) => string, indent: string): string {
  const at = `${twin.axis}=${twin.to}`;
  if (twin.twins.length === 0) return `${indent}no twin recorded at ${at}`;
  const names = twin.twins.map(nameOf).join(', ');
  return twin.twins.length === 1 ? `${indent}twin at ${at}: ${names}` : `${indent}${twin.twins.length} twins at ${at}: ${names}`;
}

/** What `--where` kept, said before the cases it kept. */
export function whereText(where: CoveringWhere | undefined): readonly string[] {
  if (where === undefined) return [];
  return [
    `Kept the ${where.kept} of ${where.of} case${where.of === 1 ? '' : 's'} that said ${where.asked.join(' and ')}.`,
    ...where.unmeasured === 0 ? [] : [
      `${where.unmeasured} case${where.unmeasured === 1 ? ' was' : 's were'} not listened to, so whether ${
        where.unmeasured === 1 ? 'it' : 'they'
      } said any of that is unmeasured.`,
    ],
    ...where.outside.map((note) => `  ${note}`),
  ];
}
