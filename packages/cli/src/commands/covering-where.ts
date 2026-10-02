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
 * the name stands at it. The twin is the parent `names.ts` finds for a
 * subject, taken over what a case said instead of what it is called.
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
import type { ExecutionIndex, ExecutionTest } from '@variance-authority/sense/test-selection';
import type { WhereCondition } from '../covering-args.js';
import type { AxisConfig, NamesConfig } from '../config.js';

type CasePrecondition = NonNullable<ExecutionTest['preconditions']>[number];

/** What `--where` kept, out of how many, and what it could not read. */
export interface CoveringWhere {
  /** The conditions, as given. */
  readonly asked: readonly string[];
  readonly kept: number;
  readonly of: number;
  /** Cases on a row nobody listened to: whether they said any of it is unmeasured. */
  readonly unmeasured: number;
  /** Values a kept case said on a declared axis that the axis does not name. */
  readonly outside: readonly string[];
}

/** A listed case and the cases one step toward the base on its last declared axis. */
export interface CoveringTwin {
  readonly case: string;
  readonly axis: string;
  /** The value the case holds. */
  readonly from: string;
  /** The nearest value toward the base a recorded case holds, or the base when none does. */
  readonly to: string;
  /** Every case at that coordinate; empty is *no twin recorded*. */
  readonly twins: readonly string[];
}

/**
 * The `names` grammar of the checkout the question is asked in, when it declares one.
 *
 * Only the section is read. `covering` answers before the rest of a config is
 * required, so a checkout whose config does not yet name a profile still
 * reads its axes.
 */
export async function namesAt(root: string): Promise<NamesConfig | undefined> {
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
  names: NamesConfig | undefined,
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
    && where.every((condition) => holds(test.preconditions!, condition, axisOf(names, condition.name))));
  return {
    index: keepCases(index, new Set(kept.map((test) => test.id))),
    where: { asked, kept: kept.length, of: index.tests.length, unmeasured, outside: outside(kept, names) },
  };
}

function holds(said: readonly CasePrecondition[], condition: WhereCondition, axis: AxisConfig | undefined): boolean {
  const values = said.filter((held) => held.name === condition.name).map((held) => String(held.value));
  // A case that never said a declared axis stands at its base.
  if (values.length === 0 && axis !== undefined) values.push(axis.values[0]!);
  return condition.value === undefined ? values.length > 0 : values.includes(condition.value);
}

function outside(kept: readonly ExecutionTest[], names: NamesConfig | undefined): readonly string[] {
  const notes = new Set<string>();
  for (const test of kept) {
    for (const held of test.preconditions ?? []) {
      const axis = axisOf(names, held.name);
      if (axis === undefined || axis.values.includes(String(held.value))) continue;
      notes.add(`${held.name}=${String(held.value)} (${held.site}) is not one of ${axis.values.join(', ')}`);
    }
  }
  return [...notes];
}

/**
 * Each listed case's twin, looked up among every case the question reached.
 *
 * The walk is `structuralParent`'s: from the value below the case's toward the
 * base, the first coordinate a recorded case holds. It differs in what it
 * returns at a coordinate several cases hold — all of them, where a subject's
 * parent must be one — because a twin is read, not diffed against.
 */
export function twinsOf(
  listed: readonly ExecutionTest[],
  reached: readonly ExecutionTest[],
  names: NamesConfig,
): readonly CoveringTwin[] {
  const twins: CoveringTwin[] = [];
  for (const test of listed) {
    const coordinate = coordinateOf(test, names);
    if (coordinate === undefined) continue;
    const axis = [...names.axes].reverse().find((entry) => {
      const value = coordinate.get(entry.axis);
      return value !== undefined && value !== entry.values[0] && entry.values.includes(value);
    });
    if (axis === undefined) continue;
    const from = coordinate.get(axis.axis)!;
    let to = axis.values[0]!;
    let found: string[] = [];
    for (let below = axis.values.indexOf(from) - 1; below >= 0; below--) {
      to = axis.values[below]!;
      const wanted = new Map(coordinate).set(axis.axis, to);
      found = reached
        .filter((other) => other.id !== test.id && same(coordinateOf(other, names), wanted))
        .map((other) => other.id)
        .sort((left, right) => left < right ? -1 : left > right ? 1 : 0);
      if (found.length > 0) break;
    }
    twins.push({ case: test.id, axis: axis.axis, from, to, twins: found });
  }
  return twins;
}

/**
 * What a case said, one value per name, with every declared axis at its base
 * when unsaid. A contradiction is held as both values joined, so it matches
 * only the same contradiction; a case nobody listened to has no coordinate.
 */
function coordinateOf(test: ExecutionTest, names: NamesConfig): Map<string, string> | undefined {
  if (test.preconditions === undefined) return undefined;
  const values = new Map<string, Set<string>>();
  for (const held of test.preconditions) {
    values.set(held.name, (values.get(held.name) ?? new Set()).add(String(held.value)));
  }
  const coordinate = new Map([...values].map(([name, said]) => [name, [...said].sort().join('|')]));
  for (const axis of names.axes) if (!coordinate.has(axis.axis)) coordinate.set(axis.axis, axis.values[0]!);
  return coordinate;
}

function same(left: ReadonlyMap<string, string> | undefined, right: ReadonlyMap<string, string>): boolean {
  if (left === undefined || left.size !== right.size) return false;
  for (const [name, value] of right) if (left.get(name) !== value) return false;
  return true;
}

function axisOf(names: NamesConfig | undefined, name: string): AxisConfig | undefined {
  return names?.axes.find((entry) => entry.axis === name);
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

function valued(held: CasePrecondition): string {
  return held.value === true ? held.name : `${held.name}=${String(held.value)}`;
}

/** The lines a twin prints under its case. */
export function twinText(twin: CoveringTwin, nameOf: (id: string) => string, indent: string): string {
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
