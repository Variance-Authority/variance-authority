/**
 * The members an interface, a type alias or a class declares, for the answer
 * that names it.
 *
 * A signature is what is written before the body, so an interface's answer
 * would stop at `interface Shape` and say nothing of what a value of it holds.
 * The scan records every member each file declares, on the container that
 * holds it, with the text of the line it is declared on, so the members are
 * read off the source index and each is shown as its line read when the index
 * recorded it.
 */

// compass: variance-authority.report.agent-surface

import { membersOn } from '@variance-authority/sense';
import { byFile, type Located } from './format.js';

/**
 * `Members:` and one row per line that declares a member of the container
 * `on` in `at`, the file relative to `root`, said once above them as
 * {@link byFile} groups rows, each as the index recorded the
 * line, and by its name when the index kept no text of it; a line the
 * declaration at `line` already shows is not shown again.
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
  const shown = new Set([line]);
  const rows: Located[] = [];
  for (const member of found) {
    if (shown.has(member.line)) continue;
    shown.add(member.line);
    rows.push({ file: at, line: member.line, text: member.text?.trim() ?? member.name });
  }
  return rows.length === 0 ? [] : ['', 'Members:', ...byFile(rows)];
}
