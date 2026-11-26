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

import type { ContainerMember } from '@variance-authority/sense';
import type { Located } from './format.js';

/**
 * One row per line of `file` that declares one of `members`, in their order,
 * as the index recorded the line, or by the member's name when it kept no
 * text; a line in `shown`, or one an earlier member already showed, is not
 * shown again, so a line that declares three members reads once.
 */
export function memberLines(file: string, members: readonly ContainerMember[], shown: readonly number[]): readonly Located[] {
  const seen = new Set(shown);
  const rows: Located[] = [];
  for (const member of members) {
    if (seen.has(member.line)) continue;
    seen.add(member.line);
    rows.push({ file, line: member.line, text: member.text?.trim() ?? member.name });
  }
  return rows;
}
