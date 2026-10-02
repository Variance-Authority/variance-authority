import { isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import preconditions from './case-preconditions.cjs';
import { column, type Stored } from './format-layout.js';
import { projectPath } from './instrumented-modules.js';
import type { ExecutionTest } from './reverse.js';

/**
 * One precondition a case named: what it said, and the call that said it. Two
 * under one name on a row are a contradiction the case said.
 */
export interface CasePrecondition {
  readonly name: string;
  readonly value: string | number | boolean;
  /** The repository-relative `file:line` of the call. */
  readonly site: string;
  /**
   * Where it was said: how many describes deep the `beforeEach` that said it
   * was declared, `0` for one at the top of the file, and `65535` for the case
   * body. A narrower level overrides a wider one, and a merge of two runs of
   * the case resolves by it as one run does.
   */
  readonly level: number;
}

/** What a frame owner carries: the calls as the realm heard them. */
export type Said = NonNullable<ReturnType<typeof preconditions.saidOf>>;

/**
 * Every call a case's frames carried, joined: undefined until a frame carries
 * the field, and the calls of every frame after.
 */
export function heardAcross(held: Said | undefined, said: Said | undefined): Said | undefined {
  if (said === undefined) return held;
  return held === undefined ? said : [...held, ...said];
}

/** A joined case's calls, as the field a journal holds, or no field where no frame listened. */
export function heardOf(said: Said | undefined): { readonly said?: Said } {
  return said === undefined ? {} : { said };
}

/**
 * A case's row from the calls its frames carried, each site named from the
 * checkout: a realm spells the file as its stack does — a path, a `file:` URL,
 * or a dev server's `/@fs/` URL — and the row names it as every other row names
 * a file.
 */
export function preconditionsHeard(root: string, said: Said | undefined): { readonly preconditions?: readonly CasePrecondition[] } {
  return said === undefined ? {} : { preconditions: preconditions.resolve(checkoutSaid(root, said)) };
}

/** The calls with each site named from the checkout, for a reader that resolves them later. */
export function checkoutSaid(root: string, said: Said): Said {
  return said.map(([name, value, site, level]) => [name, value, checkoutSite(root, site), level]);
}

function checkoutSite(root: string, site: string): string {
  const colon = site.lastIndexOf(':');
  if (colon <= 0) return site;
  let file = site.slice(0, colon);
  if (file.startsWith('file:')) file = fileURLToPath(file);
  else if (/^https?:/u.test(file)) {
    const served = /\/@fs(\/.*)$/u.exec(new URL(file).pathname);
    // FIXME: a browser realm's site served from the dev server's root, not
    // `/@fs/`, keeps its URL — needs the server's root to name the file.
    if (served === null) return site;
    file = decodeURIComponent(served[1]!);
  }
  return isAbsolute(file) ? `${projectPath(root, file)}${site.slice(colon)}` : site;
}

/**
 * The case index's column of named preconditions, one word per case.
 *
 * Each word is a string id: the case's preconditions as
 * `[name, value, site, level]` tuples, in the order
 * {@link ExecutionTest.preconditions} holds them. Most cases of a file say the
 * same thing — the same `beforeEach` runs for each of them — so the string
 * table holds each distinct set once, and a case pays one word. {@link UNHEARD} is a case whose producer never listened.
 *
 * The column is optional and read by name, as `tests.stopped` is: an index
 * written before it, or by a producer that never listened to any case, has none,
 * and every case it holds reads as unmeasured rather than as one that named
 * nothing.
 */
export const PRECONDITIONS_COLUMN = 'tests.casePreconditions';

const UNHEARD = 0xffffffff;

/** The string a case's preconditions are stored as, or nothing for a case nobody listened to. */
function spelled(test: ExecutionTest): string | undefined {
  return test.preconditions === undefined
    ? undefined
    : JSON.stringify(test.preconditions.map(({ name, value, site, level }) => [name, value, site, level]));
}

/** The strings the column names, for the index's string table. */
export function preconditionStrings(tests: readonly ExecutionTest[]): readonly string[] {
  const held: string[] = [];
  for (const test of tests) {
    const text = spelled(test);
    if (text !== undefined) held.push(text);
  }
  return held;
}

/** The column, or no column at all when no case was listened to. */
export function preconditionColumn(
  tests: readonly ExecutionTest[],
  id: (value: string) => number,
): Readonly<Record<string, Stored>> {
  if (tests.every((test) => test.preconditions === undefined)) return {};
  return {
    [PRECONDITIONS_COLUMN]: column(Uint32Array.from(tests, (test) => {
      const text = spelled(test);
      return text === undefined ? UNHEARD : id(text);
    })),
  };
}

/**
 * What two runs of one case named, as one row, resolved as the calls of one
 * run are: per name the narrowest level wins, so a body one run reached
 * overrides the `beforeEach` a run that never reached it heard, and two values
 * at that level are both kept, which is the contradiction a retry that changed
 * its mind is. Unmeasured only where neither run was listened to.
 */
export function preconditionsAcross(
  before: readonly CasePrecondition[] | undefined,
  after: readonly CasePrecondition[] | undefined,
): { readonly preconditions?: readonly CasePrecondition[] } {
  if (before === undefined && after === undefined) return {};
  return {
    preconditions: preconditions.resolve(
      [...(before ?? []), ...(after ?? [])].map(({ name, value, site, level }) => [name, value, site, level] as const),
    ),
  };
}

/** One case's preconditions off the column, where it has a word that says some. */
export function preconditionsFrom(
  held: Uint32Array | undefined,
  at: number,
  string: (id: number) => string,
): { readonly preconditions?: readonly CasePrecondition[] } {
  const word = held?.[at];
  if (word === undefined || word === UNHEARD) return {};
  return preconditionsSpelled(string(word));
}

/** One case's preconditions off the string the column stores them as. */
export function preconditionsSpelled(text: string): { readonly preconditions: readonly CasePrecondition[] } {
  const parsed = JSON.parse(text) as unknown;
  if (!Array.isArray(parsed)) throw new Error('not a variance-authority execution index');
  return {
    preconditions: parsed.map((said: unknown): CasePrecondition => {
      const [name, value, site, level] = said as [string, string | number | boolean, string, number];
      return { name, value, site, level };
    }),
  };
}
