/**
 * The rows of a Help value a question names, read by what the question holds.
 *
 * `help.exported` and the imports by path are the tables of every file, right
 * for an answer that is the table. A question about one name, one file or one
 * specifier asks here: the store's reader finds the rows and decodes those,
 * in the order the table holds them.
 */

// compass: variance-authority.report.agent-surface

import type { Deep, Help, Named } from '@variance-authority/package/help';
import { searchIndexOf } from '../snapshot.js';
import type { PathGroup } from '../store-rows.js';

/** Every export written under `name`. */
export function exportedNamed(help: Help, name: string): readonly Named[] {
  const rows = searchIndexOf(help).rows;
  return [...rows.exportedNamed(name)].map(rows.named);
}

/** Every export of the file `at`. */
export function exportedIn(help: Help, at: string): readonly Named[] {
  const rows = searchIndexOf(help).rows;
  return [...rows.exportedIn(at)].map(rows.named);
}

/** Every export of the files `among`, in the order the export list holds them. */
export function exportedAmong(help: Help, among: Iterable<string>): readonly Named[] {
  const rows = searchIndexOf(help).rows;
  const found: number[] = [];
  for (const at of new Set(among)) found.push(...rows.exportedIn(at));
  return found.sort((left, right) => left - right).map(rows.named);
}

/** Every import by path that takes `name`, deep ones first. */
export function pathsTaking(help: Help, name: string): readonly (readonly [Deep, PathGroup])[] {
  const rows = searchIndexOf(help).rows;
  return rows.pathsTaking(name).map(rows.path);
}

/** Every import by path written as exactly `specifier`, deep ones first. */
export function pathsWritten(help: Help, specifier: string): readonly (readonly [Deep, PathGroup])[] {
  const rows = searchIndexOf(help).rows;
  return rows.pathsWritten(specifier).map(rows.path);
}
