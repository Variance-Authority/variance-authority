import { codeUnitOrder } from '@variance-authority/core/segment';
import type { Documented, Entry, Opening, PassedOn, Use } from '@variance-authority/package/help';
import { mayBeRead, opening } from '@variance-authority/package/help';
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
  return `${entry.name} [${entry.kind}] ${entry.usedBy.length} packages, ${entry.uses} imports — ${said}`;
}

/** `block` after what `lines` already holds, a blank line between them. */
export function section(lines: string[], ...block: readonly string[]): void {
  lines.push(...(lines.length > 0 ? [''] : []), ...block);
}

/** `count` and the noun, singular at one. */
export const plural = (count: number, one: string, many = `${one}s`): string => `${count} ${count === 1 ? one : many}`;

/** An argument a shell passes through unchanged, quoted only when it would not be. */
export function shell(value: string): string {
  return /^[\w@./:=+-]+$/u.test(value) ? value : `'${value.replace(/'/gu, `'\\''`)}'`;
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

/** The line a caller writes to reach this name. */
export function importing(published: Documented, held: Opening, entry: Entry): string {
  const specifier = specifierOf(published, held);
  return `import { ${entry.name} } from '${specifier}';`;
}

/**
 * Where a name is written: the line that declares it, or, for a name no file the
 * workspace reads declares, the line that passes it on from the module that does.
 */
export function placed(published: Documented, entry: Entry): string {
  const passed = entry.passesOn;
  if (passed === undefined) return `declared at ${entry.at}:${entry.line}`;
  return `published by ${published.name}, passes on ${passedOn(passed)} at ${entry.at}:${entry.line}`;
}

/** What an entry passes on from outside the sources: `thirdp's \`parseSync\``, or everything a module exports. */
export function passedOn(passed: PassedOn): string {
  return passed.name === '*' ? `everything ${passed.from} exports` : `${passed.from}'s \`${passed.name}\``;
}

/** One name in full, including the head somebody would copy. */
export function block(published: Documented, held: Opening, entry: Entry, undecided: Undecided): string {
  const lines = [
    `${entry.name} [${entry.kind}]`,
    importing(published, held, entry),
    placed(published, entry),
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
  // A line passing a name on declares nothing.
  const above = `Nothing is written above this ${entry.passesOn === undefined ? 'declaration' : 'line'}.`;
  if (entry.mention === undefined) return [above];

  return [
    `${above} ${entry.mention.at}:${entry.mention.line} names it:`,
    '',
    entry.mention.text,
  ];
}
