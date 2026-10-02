import { column, type Stored } from './format-layout.js';
import type { CasePrecondition, ExecutionTest } from './reverse.js';

/**
 * The case index's column of named preconditions, one word per case.
 *
 * Each word is a string id: the case's preconditions as `[name, value, site]`
 * triples, in the order {@link ExecutionTest.preconditions} holds them. Most
 * cases of a file say the same thing — a file-level default, a `describe`'s
 * mock — so the string table holds each distinct set once, and a case pays one
 * word. {@link UNHEARD} is a case whose producer never listened.
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
    : JSON.stringify(test.preconditions.map(({ name, value, site }) => [name, value, site]));
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
 * What two runs of one case named, as one row: every distinct name and value,
 * each at its first site, ordered as the fold orders them. Two runs that named
 * different values keep both, which is the contradiction a retry that changed
 * its mind is. Unmeasured only where neither run was listened to.
 */
export function preconditionsAcross(
  before: readonly CasePrecondition[] | undefined,
  after: readonly CasePrecondition[] | undefined,
): { readonly preconditions?: readonly CasePrecondition[] } {
  if (before === undefined && after === undefined) return {};
  const held = new Map<string, CasePrecondition>();
  for (const said of [...(before ?? []), ...(after ?? [])]) {
    const key = `${said.name}\u0000${typeof said.value}:${String(said.value)}`;
    const seen = held.get(key);
    if (seen === undefined || said.site < seen.site) held.set(key, said);
  }
  return { preconditions: [...held.entries()].sort(([left], [right]) => left < right ? -1 : left > right ? 1 : 0).map(([, said]) => said) };
}

/** One case's preconditions off the column, where it has a word that says some. */
export function preconditionsFrom(
  held: Uint32Array | undefined,
  at: number,
  string: (id: number) => string,
): { readonly preconditions?: readonly CasePrecondition[] } {
  const word = held?.[at];
  if (word === undefined || word === UNHEARD) return {};
  const parsed = JSON.parse(string(word)) as unknown;
  if (!Array.isArray(parsed)) throw new Error('not a variance-authority execution index');
  return {
    preconditions: parsed.map((triple: unknown): CasePrecondition => {
      const [name, value, site] = triple as [string, string | number | boolean, string];
      return { name, value, site };
    }),
  };
}
