/**
 * The members an interface, a type alias or a class declares, for the answer
 * that names it.
 *
 * A signature is what is written before the body, so an interface's answer
 * would stop at `interface Shape` and say nothing of what a value of it holds.
 * The scan records every member each file declares, on the container that
 * holds it, so the members are read off the source index and each is shown as
 * its line reads in the checkout now.
 */

// compass: variance-authority.report.agent-surface

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { membersOn } from '@variance-authority/sense';

/**
 * `Members:` and one row per line that declares a member of the container
 * `on` in `at`, the file relative to `root`, each as the checkout holds the
 * line; a line the declaration at `line` already shows is not shown again.
 * Nothing when the name declares no members or no index is published; why,
 * when the index does not read.
 */
export function memberRows(root: string | undefined, at: string, on: string, line: number): readonly string[] {
  if (root === undefined) return [];
  let found: ReturnType<typeof membersOn>;
  try {
    found = membersOn(root, at, on);
  } catch (error) {
    return ['', `Members were not read: ${error instanceof Error ? error.message : String(error)}; run \`variance index\`.`];
  }
  if (found === undefined || found.length === 0) return [];
  const text = linesOf(join(root, at));
  const shown = new Set([line]);
  const rows: string[] = [];
  for (const member of found) {
    if (shown.has(member.line)) continue;
    shown.add(member.line);
    // A file that is gone, or shorter than the parse, has no line to show.
    const written = text[member.line - 1]?.trim();
    rows.push(`${at}:${member.line} — ${written === undefined || written === '' ? member.name : written}`);
  }
  return rows.length === 0 ? [] : ['', 'Members:', ...rows];
}

/** The lines of the file at `path`, or none when it is gone. */
function linesOf(path: string): readonly string[] {
  try {
    return readFileSync(path, 'utf8').split(/\r?\n/);
  } catch {
    return [];
  }
}
