import type { Documented, Entry, Opening } from '@variance-authority/package/help';
import { opening } from '@variance-authority/package/help';
import { specifierOf } from './find.js';

/**
 * The two shapes every answer here is made of.
 *
 * A line, for a list, and a block, for the one thing that was asked about. The
 * split is a budget: a list of two hundred names that each carried a signature
 * and a paragraph would spend a context window on the two hundred names the
 * asker did not want, and a model that runs out of room mid-list cannot tell
 * that it did.
 */

/**
 * Who imports this, counted first and named second.
 *
 * The count leads because it is what a reader ranks on, and the names are capped
 * because a name imported by fifteen packages would otherwise spend a paragraph
 * saying so — in a list where the next line is a different name. A cap that says
 * it is a cap costs six words and never reads as a complete list.
 */
export function audience(entry: Entry, cap: number): string {
  const shown = entry.usedBy.slice(0, cap);
  const rest = entry.usedBy.length - shown.length;
  const named = `${shown.join(', ')}${rest > 0 ? `, and ${rest} more` : ''}`;
  return `${entry.usedBy.length} ${entry.usedBy.length === 1 ? 'package' : 'packages'}: ${named}`;
}

/** How much of the repository reaches for this, in the words an asker ranks on. */
export function reach(entry: Entry): string {
  if (entry.usedBy.length === 0) return 'used by nothing outside its own package';
  return `used by ${audience(entry, 12)} — ${entry.uses} ${entry.uses === 1 ? 'import' : 'imports'}`;
}

/** One name in a list: what it is, how used it is, and the first thing its doc says. */
export function line(entry: Entry): string {
  const said = entry.doc === undefined ? 'UNDOCUMENTED' : opening(entry.doc);
  return `${entry.name} [${entry.kind}] ${entry.usedBy.length} packages, ${entry.uses} imports — ${said}`;
}

/** The line a caller writes to reach this name. */
export function importing(published: Documented, held: Opening, entry: Entry): string {
  const specifier = specifierOf(published, held);
  return `import { ${entry.name} } from '${specifier}';`;
}

/** One name in full, including the head somebody would copy. */
export function block(published: Documented, held: Opening, entry: Entry): string {
  const lines = [
    `${entry.name} [${entry.kind}]`,
    importing(published, held, entry),
    `declared at ${entry.at}:${entry.line}`,
    reach(entry),
  ];

  if (entry.signature !== undefined) lines.push('', entry.signature);
  lines.push('', entry.doc ?? 'Nothing is written above this declaration.');
  return lines.join('\n');
}
