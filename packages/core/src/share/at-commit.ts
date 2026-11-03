/**
 * A mainline's record kept at the commit it ran at, beside the latest.
 *
 * The latest answers a checkout at the mainline's tip. A checkout behind it —
 * a release branch, a pull request cut last week, a user who does not track
 * the tip — is measured against its merge base, and the latest is a record of
 * code it does not have: every commit between is charged to it. So each
 * mainline publish also writes the line `at/<commit>/…` (`publishLine`),
 * and a reader asks for its merge base's, then the nearest kept behind it,
 * before the latest.
 *
 * Nothing is removed unless somebody asks ({@link purgeKept}). A store whose
 * cell cannot list lines keeps the latest only.
 */

import type { KeptAt, LineCell, ShareLine, ShareMiss } from './line.js';

/** The line that holds `line`'s record at `commit`. */
export function atCommit(line: ShareLine, commit: string): ShareLine {
  return { kind: line.kind, name: line.name, at: commit };
}

/** The commits a publish kept its record at, and the miss that stopped it before it finished. */
export interface KeptCommits {
  readonly kept: readonly string[];
  readonly miss?: ShareMiss;
}

/**
 * Remove what `line` keeps by commit written before `before`, and name the
 * commits removed. The latest stays, and a store that keeps none removes none.
 */
export async function purgeKept(cell: LineCell, line: ShareLine, before: number): Promise<readonly string[] | ShareMiss> {
  if (cell.commits === undefined || cell.drop === undefined) return [];
  const held = await cell.commits(line);
  if (!Array.isArray(held)) return held as ShareMiss;
  const old = (held as readonly KeptAt[]).filter((one) => one.written < before).map((one) => one.commit);
  if (old.length === 0) return [];
  const dropped = await cell.drop(old.map((commit) => atCommit(line, commit)));
  return dropped === 'dropped' ? old : dropped;
}
