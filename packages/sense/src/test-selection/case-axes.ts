// compass: variance-authority.reach

/**
 * What a case said, read on the axes `names.axes` declares, as a subject's name
 * is read on them.
 *
 * A named precondition is a state a case arranged, and where the name is a
 * declared axis its value means what the same word means in a subject id:
 * `values[0]` is the base, and a case that never said the name stands at it.
 * The twin of a case is the parent {@link structuralParent} finds for a
 * subject, walked by the same {@link stepTowardBase} over what the case said
 * instead of what it is called. Every reader of a case on an axis reads it
 * here, so a question asked of the record and a report about a snapshot
 * cannot disagree on which value a case holds.
 */

import type { CasePrecondition } from './case-precondition-column.js';
import { axisOf, coordinateKey, stepTowardBase, type NamedAxis, type NameGrammar } from './name-grammar.js';
import type { ExecutionTest } from './reverse.js';

/** A value a case said on a declared axis that the axis does not name. */
export interface OutsideVocabulary {
  readonly axis: string;
  readonly value: string;
  /** The call that said it, `file:line`. */
  readonly site: string;
  /** What the axis takes, base first. */
  readonly values: readonly string[];
}

/** A case and the cases one step toward the base on its last declared axis. */
export interface CaseTwin {
  readonly case: string;
  readonly axis: string;
  /** The value the case holds. */
  readonly from: string;
  /** The nearest value toward the base a recorded case holds, or the base when none does. */
  readonly to: string;
  /** Every case at that coordinate, in code-unit order; empty is *no twin recorded*. */
  readonly twins: readonly string[];
}

/**
 * The values a case holds under a name: every value it said, a contradiction's
 * both sides included, or the axis base when the name is a declared axis the
 * case never said. Nothing for an undeclared name it never said, because
 * nothing says what an unsaid undeclared name is.
 */
export function heldValues(said: readonly CasePrecondition[], name: string, grammar: NameGrammar | undefined): readonly string[] {
  const values = said.filter((held) => held.name === name).map((held) => String(held.value));
  if (values.length > 0) return values;
  const axis = axisOf(grammar, name);
  return axis === undefined ? [] : [axis.values[0]!];
}

/** Every value a case said on a declared axis that the axis does not name, in the order said. */
export function outsideVocabulary(said: readonly CasePrecondition[], grammar: NameGrammar | undefined): readonly OutsideVocabulary[] {
  return said.flatMap((held) => {
    const axis = axisOf(grammar, held.name);
    const value = String(held.value);
    if (axis === undefined || axis.values.includes(value)) return [];
    return [{ axis: axis.axis, value, site: held.site, values: axis.values }];
  });
}

/**
 * Each listed case's twin, looked up among the cases of its own test file
 * reached.
 *
 * Only its own file: a case that said nothing stands at the base of every
 * axis, so across files every such case would be the twin of every case that
 * said a value — a list of strangers, not the case beside it.
 *
 * From the value below the case's on its last declared axis toward the base,
 * the first coordinate a reached case holds. A coordinate several cases hold
 * gives all of them, where a subject's parent must be one, because a twin is
 * read, not diffed against. A case at the base, or nobody listened to, has no
 * entry.
 */
export function caseTwins(
  listed: readonly ExecutionTest[],
  reached: readonly ExecutionTest[],
  grammar: NameGrammar,
): readonly CaseTwin[] {
  const placed = new Map<string, Placed | undefined>();
  const place = (test: ExecutionTest): Placed | undefined => {
    if (!placed.has(test.id)) placed.set(test.id, placeOf(test, grammar));
    return placed.get(test.id);
  };
  const at = new Map<string, string[]>();
  for (const test of reached) {
    const here = place(test);
    if (here === undefined) continue;
    const key = `${test.file}\0${coordinateKey(here.stem, here.coordinate)}`;
    at.set(key, [...at.get(key) ?? [], test.id]);
  }
  return listed.flatMap((test) => {
    const here = place(test);
    const walked = here === undefined ? undefined : stepTowardBase(here.coordinate, grammar, (coordinate) =>
      (at.get(`${test.file}\0${coordinateKey(here.stem, coordinate)}`) ?? []).filter((other) => other !== test.id));
    if (walked === undefined) return [];
    const twins = [...walked.found].sort(byCodeUnit);
    return [{ case: test.id, axis: walked.axis, from: walked.from, to: walked.to, twins }];
  });
}

/** A case placed as a name is: what it said off every axis, and where it stands on them. */
interface Placed {
  readonly stem: string;
  readonly coordinate: readonly NamedAxis[];
}

/**
 * What a case said, read the way `readName` reads a subject id. A declared
 * axis said at a value its vocabulary names is a step of the coordinate, in
 * grammar order, and at its base — said or not — it is no step at all.
 * Everything else, an undeclared name, a value outside the vocabulary or a
 * contradiction held as both values joined, is the stem, as an unread tail of
 * a name is: only a case that said the same matches it. A case nobody listened
 * to is placed nowhere.
 */
function placeOf(test: ExecutionTest, grammar: NameGrammar): Placed | undefined {
  if (test.preconditions === undefined) return undefined;
  const values = new Map<string, Set<string>>();
  for (const held of test.preconditions) {
    values.set(held.name, (values.get(held.name) ?? new Set()).add(String(held.value)));
  }
  const said = new Map([...values].map(([name, all]) => [name, [...all].sort(byCodeUnit).join('|')]));
  const coordinate: NamedAxis[] = [];
  for (const axis of grammar.axes) {
    const value = said.get(axis.axis);
    if (value === undefined || !axis.values.includes(value)) continue;
    said.delete(axis.axis);
    if (value !== axis.values[0]) coordinate.push({ axis: axis.axis, value });
  }
  return { stem: JSON.stringify([...said].sort(([left], [right]) => byCodeUnit(left, right))), coordinate };
}

function byCodeUnit(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
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
