/** Configured import tables joined by the native selection graph. */
// compass: variance-authority.reach
import { readFile } from 'node:fs/promises';

export { shadowReach, type ShadowReach } from './reach.js';
export { auditTaints, type AuditedTaints, type TaintAuditOptions, type TaintDeviation, type TaintDeviationKind } from './audit.js';

/** Specifiers a configured table adds to or shadows for one file. */
export interface ImportDiff {
  readonly minus?: readonly string[];
  readonly plus?: readonly string[];
}

/** One named configured import table; source declarations are read natively. */
export interface Taint {
  readonly name: string;
  readonly diffs?: ReadonlyMap<string, ImportDiff>;
}

/** The JSON form of a configured import table. */
export type TaintTable = Readonly<
  Record<string, { readonly '-'?: readonly string[]; readonly '+'?: readonly string[] }>
>;

/** A taint from a table already in memory. */
export function taintTable(name: string, table: TaintTable): Taint {
  const diffs = new Map<string, ImportDiff>();
  for (const [file, row] of Object.entries(table)) {
    diffs.set(file, {
      ...(row['-'] === undefined ? {} : { minus: row['-'] }),
      ...(row['+'] === undefined ? {} : { plus: row['+'] }),
    });
  }

  return { name, diffs };
}

/**
 * A taint from a JSON file: `{ "src/a.test.ts": { "-": ["./b"], "+": ["./c"] } }`.
 *
 * Named after the file, so a report that says which taint cut an edge names
 * something a person can open. A file that is not there or not that shape is
 * an error and not an empty taint: a taint the user pointed at and that
 * contributed nothing would be a silent return to the untainted graph.
 */
export async function taintFile(path: string): Promise<Taint> {
  const text = await readFile(path, 'utf8');
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${path} is not a taint table: expected an object keyed by file path`);
  }

  return taintTable(path, parsed as TaintTable);
}
