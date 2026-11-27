import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Documented, Entry, Opening, Use } from '@variance-authority/package/help';
import { mayBeRead, opening } from '@variance-authority/package/help';
import { SLOT } from './declaration-key.js';
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

/**
 * What the caller read of the places that may read a name: `may`, reads off
 * the module's `default` and the module passed on whole, which are no use of
 * it, and whether any place imports it for certain. The caller partitions the
 * sites, so every line of one answer names the same places.
 */
export interface Undecided {
  readonly may: readonly Use[];
  readonly imported: boolean;
}

/**
 * How many other packages reach for this by its published path, in the words
 * an asker ranks on, and where it may be read. The imports inside its own
 * package are not in the Help value, and the caller that reads them counts
 * them apart.
 */
export function reach(entry: Entry, { may, imported }: Undecided): string {
  if (entry.usedBy.length === 0) {
    return may.length === 0
      ? 'no other package imports it by its published path'
      : `no other package imports it by name through its published path; it ${mayBeRead(may)}${imported ? '' : ', so whether it is used is unknown'}`;
  }
  const also = may.length === 0 ? '' : `; it also ${mayBeRead(may)}`;
  return `used by ${audience(entry, 12)} — ${entry.uses} ${entry.uses === 1 ? 'import' : 'imports'} by published path${also}`;
}

/** What a list line reads of a published name: the audience counted, never named. */
export interface Listed {
  readonly name: string;
  readonly kind: string;
  readonly doc?: string;
  readonly usedBy: { readonly length: number };
  readonly uses: number;
}

/** One name in a list: what it is, how used it is, and the first thing its doc says. */
export function line(entry: Listed): string {
  const said = entry.doc === undefined ? 'UNDOCUMENTED' : opening(entry.doc);
  return `${entry.name} [${entry.kind}] ${byPublishedPath(entry.uses, entry.usedBy.length)} — ${said}`;
}

/**
 * The imports of a name other packages write by a path it is published from,
 * and how many packages write them: what the Help value counts beside each
 * entry, which leaves out the imports within its own package and by file path.
 */
export function byPublishedPath(imports: number, packages: number): string {
  return imports === 0 ? 'no other package imports it by its published path' : `${plural(imports, 'import')} by published path from ${plural(packages, 'other package')}`;
}

/** `block` after what `lines` already holds, a blank line between them. */
export function section(lines: string[], ...block: readonly string[]): void {
  lines.push(...(lines.length > 0 ? [''] : []), ...block);
}

/** Where a recording tool's answer comes from, said by each in the same words. */
export const RECORDING = 'Reads the recording a test run with test selection published';

/** `count` and the noun, singular at one. */
export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** The lines a block or a declaration spans, as `line 4` or `lines 3–9`. */
export const linesOf = (span: { readonly line: number; readonly end: number }): string =>
  span.line === span.end ? `line ${span.line}` : `lines ${span.line}–${span.end}`;

/** The default number of names on the one line that stands for a list the repository's own answer outranks. */
export const NAMED = 5;

/** A compact list: the requested names (five by default), the number omitted, and `whole` when it can show what the line omits. */
export function named(head: string, names: readonly string[], total: number, whole: string, limit = NAMED): readonly string[] {
  const shown = names.slice(0, limit);
  const remaining = total - shown.length;
  return ['', `${head}: ${shown.join(', ')}${remaining > 0 ? ` and ${remaining} more. ${whole}` : '.'}`];
}

/** The commands that take an answer further, after a blank line and a heading; nothing when there are none. */
export function narrower(asks: readonly string[]): readonly string[] {
  return asks.length === 0 ? [] : ['', 'Narrower questions:', ...asks.map((command) => `  ${command}`)];
}

/** `<specifier> — N names, U imported elsewhere, D documented`. */
export function openingRow(published: Documented, held: Opening): string {
  return `${specifierOf(published, held)} — ${plural(held.entries.length, 'name')}, ${used(held)} imported elsewhere, ${written(held)} documented`;
}

const used = (held: Opening): number => held.entries.filter((entry) => entry.usedBy.length > 0).length;
const written = (held: Opening): number => held.entries.filter((entry) => entry.doc !== undefined).length;

/** The specifier whose names the most packages import, ties in code-unit order; none when nothing imports any. */
export function mostUsed(
  opened: readonly (readonly [Documented, Opening])[],
): readonly [Documented, Opening] | undefined {
  return opened
    .filter(([, held]) => used(held) > 0)
    .sort((a, b) => used(b[1]) - used(a[1]) || codeUnitOrder(specifierOf(...a), specifierOf(...b)))[0];
}

/** The line a caller writes to reach this name; a default export is imported by `named`, and by no line when nothing names it. */
export function importing(published: Documented, held: Opening, entry: Entry, named = entry.name): readonly string[] {
  const specifier = specifierOf(published, held);
  if (entry.name !== SLOT) return [`import { ${entry.name} } from '${specifier}';`];
  return named === SLOT ? [] : [`import ${named} from '${specifier}';`];
}

/** One name in full, including the head somebody would copy; `named` is the name the declaration is keyed by. */
export function block(published: Documented, held: Opening, entry: Entry, undecided: Undecided, named = entry.name): string {
  const lines = [
    `${named} [${entry.kind}]`,
    ...importing(published, held, entry, named),
    `declared at ${entry.at}:${entry.line}`,
    reach(entry, undecided),
  ];

  if (entry.signature !== undefined) lines.push('', entry.signature);
  lines.push('', ...said(entry));
  return lines.join('\n');
}

/**
 * What the project says about a name, and which of the two places it said it.
 *
 * A doc comment answers directly. For a name with nothing above it there is one
 * more place to look before reporting silence, and the passage that comes back
 * is labelled with the file it came from rather than dressed as a doc comment.
 * The label is the whole point: a reader told *the README says this* knows the
 * prose was written about a package and may not describe the signature above,
 * and a reader handed the same paragraph unlabelled does not.
 */
export function said(entry: Entry): readonly string[] {
  if (entry.doc !== undefined) return [entry.doc];
  if (entry.mention === undefined) return ['Nothing is written above this declaration.'];

  return [
    `Nothing is written above this declaration. ${entry.mention.at}:${entry.mention.line} names it:`,
    '',
    entry.mention.text,
  ];
}

/*
 * The row grammar every located answer shares, read by agents for the facts
 * per token. A row is one line. What the rows on a page share is said once:
 * a file with several rows is a heading with its lines under it, as
 * `rg --heading` prints them, and the run of import steps every chain on a
 * page ends with is printed once above the rows, each row keeping its own.
 */

/** One located row: a file, a line in it, and what stands there. */
export interface Located {
  readonly file: string;
  readonly line: number;
  readonly text: string;
  /** What the row adds about that line, said on the line below it. */
  readonly note?: string;
}

/** `12: text`, the line and what stands on it, under a file already named. */
export const atLine = (line: number, text: string): string => `${line}: ${text.trimStart()}`;

/**
 * Rows in their order, a run of one file's rows said under that file once:
 * a file with one row is `file:line: text`, a file with several is the file,
 * then `  line: text` per row. A row's note follows it, one step deeper.
 */
export function byFile(rows: readonly Located[]): readonly string[] {
  const lines: string[] = [];
  for (let at = 0; at < rows.length; ) {
    const file = rows[at]!.file;
    let end = at;
    while (end < rows.length && rows[end]!.file === file) end++;
    const said = (row: Located, indent: string): void => {
      if (row.note !== undefined) lines.push(`${indent}  ${row.note}`);
    };
    if (end - at === 1) {
      lines.push(`${file}:${atLine(rows[at]!.line, rows[at]!.text)}`);
      said(rows[at]!, '');
    } else {
      lines.push(file);
      for (let row = at; row < end; row++) {
        lines.push(`  ${atLine(rows[row]!.line, rows[row]!.text)}`);
        said(rows[row]!, '  ');
      }
    }
    at = end;
  }
  return lines;
}

/**
 * The longest run of steps every chain on a page ends with, when two chains or
 * more share one; none otherwise. Even the target alone is worth saying once:
 * it is the longest step of every row. The run stops short of every chain's
 * first step, so no row's own file is folded into the end it shares.
 */
export function chainsEnd(chains: readonly (readonly string[])[]): readonly string[] {
  if (chains.length < 2) return [];
  let shared = Math.min(...chains.map((chain) => chain.length)) - 1;
  const first = chains[0]!;
  for (const chain of chains.slice(1)) {
    let same = 0;
    while (same < shared && chain[chain.length - 1 - same] === first[first.length - 1 - same]) same++;
    shared = same;
  }
  return shared === 0 ? [] : first.slice(first.length - shared);
}

/**
 * A chain short of the end every chain on its page shares: its own steps,
 * then `→ …` where the shared end follows. A chain is never cut below its
 * first step, the file the row is about.
 */
export function ownSteps(chain: readonly string[], end: readonly string[]): string {
  if (end.length === 0) return chain.join(' → ');
  const own = chain.slice(0, Math.max(1, chain.length - end.length));
  return own.length < chain.length ? `${own.join(' → ')} → …` : own.join(' → ');
}
