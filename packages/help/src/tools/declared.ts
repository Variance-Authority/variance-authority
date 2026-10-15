/**
 * Names a file declares at its top level and does not export, answered rather
 * than refused.
 *
 * Every export list stops at what a file hands out, and a file keeps most of
 * what it declares to itself: the helper a function calls, the constant beside
 * it. A caller who typed such a name exactly is not wrong about the name, and
 * `git grep` would find it at once. The source index harvested every top-level
 * declaration of every file it parsed, so the declaration is read from there,
 * and where it is written is the whole answer: nothing outside its file can
 * import it.
 */

// compass: variance-authority.report.agent-surface

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declaredOf, type DeclaredName } from '@variance-authority/sense';
import { docOf, headOf } from '../indexed-surface.js';
import type { DeclaredMatch, Matches } from './search-answer.js';

/** How many declarations of one name `symbol` writes out before it counts the rest. */
export const DECLARED_CAP = 5;

/** What the source index says about declarations, or why it says nothing. */
export type Declarations =
  | { readonly names: readonly DeclaredName[]; readonly unread: readonly string[] }
  | { readonly refused: string };

/** Source before tests before stories, then where they were written. */
const KIND_ORDER = { source: 0, test: 1, story: 2 } as const;

/**
 * The declarations `query` names — exactly, or held in the name given
 * `containing` — in `files` when they are named, read off the source index of
 * `root`, source first.
 */
export function declarations(
  root: string | undefined,
  query: string,
  options: { readonly containing?: boolean; readonly files?: Iterable<string> } = {},
): Declarations {
  if (root === undefined) return { refused: 'this host named no checkout to read the source index of' };
  let read: ReturnType<typeof declaredOf>;
  try {
    read = declaredOf(root, query, options);
  } catch (error) {
    return { refused: `${error instanceof Error ? error.message : String(error)}; run \`variance index\`` };
  }
  if (read === undefined) return { refused: 'no source index is published; run `variance index`' };
  // Stable, so the index's file-then-line order holds within a kind.
  const names = [...read.names].sort((left, right) => KIND_ORDER[left.fileKind] - KIND_ORDER[right.fileKind]);
  return { names, unread: read.unread };
}

/**
 * One declaration, as `symbol` writes it: the name and its kind, where it is
 * declared, its signature and its documentation as the checkout holds them,
 * and that nothing outside its file can import it. The signature and the
 * documentation are left out when the file no longer holds the name where the
 * index read it.
 */
export function declaredBlock(root: string, held: DeclaredName): string {
  const text = textAt(root, held);
  const signature = text === undefined ? undefined : headOf(text, spanOf(held.signatureStart, held.signatureEnd));
  const doc = text === undefined ? undefined : docOf(text, spanOf(held.docStart, held.docEnd));
  return [
    `${held.name} [${held.kind}]`,
    `declared, not exported, at ${held.at}:${held.line}${held.by === '' ? '' : ` by ${held.by}`}`,
    ...(signature === undefined ? [] : [signature]),
    ...(doc === undefined ? [] : [doc]),
    `Nothing outside ${held.at} can import it: no export of that file names it.`,
  ].join('\n');
}

/** One declaration, as a `search` line writes it. */
export function declaredLine(held: DeclaredMatch): string {
  return `${held.name} [${held.kind}] — ${held.package ?? 'the repository'} · ${held.at}:${held.line}`;
}

/** The sentence that says some files' declarations were not read, or nothing when every file's were. */
export function unreadLine(unread: readonly string[]): readonly string[] {
  if (unread.length === 0) return [];
  const files = unread.length === 1 ? '1 file' : `${unread.length} files`;
  return [`The declarations of ${files} were not read into the source index, so a name declared there is not known; run \`variance index\`.`];
}

function spanOf(start: number | null | undefined, end: number | null | undefined) {
  return start === undefined || start === null || end === undefined || end === null ? undefined : { start, end };
}

/** The file's text, when it still holds the name on the line the index read it at. */
function textAt(root: string, held: DeclaredName): string | undefined {
  let text: string;
  try {
    text = readFileSync(join(root, held.at), 'utf8');
  } catch {
    return undefined;
  }
  return text.split(/\r?\n/)[held.line - 1]?.includes(held.name) === true ? text : undefined;
}

/**
 * The blocks `symbol` answers a name with when no file exports it: one per
 * declaration, source first, the first `DECLARED_CAP` of them, a count of the
 * rest, and the files whose declarations were not read; nothing when the
 * source index is not at hand, since a name nothing exports is then unknown.
 */
export function declaredBlocks(root: string | undefined, name: string, wanted: string | undefined): readonly string[] {
  const read = declarations(root, name);
  if (root === undefined || 'refused' in read) return [];
  const held = read.names.filter((one) => wanted === undefined || one.by === wanted);
  if (held.length === 0) return [];
  const more = held.length - DECLARED_CAP;
  return [
    ...held.slice(0, DECLARED_CAP).map((one) => declaredBlock(root, one)),
    ...(more > 0 ? [`${more} more ${more === 1 ? 'declaration' : 'declarations'} of \`${name}\` not shown.`] : []),
    ...unreadLine(read.unread),
  ];
}

/** Where `symbol` finds the name declared when no file exports it, each at its line. */
export function declaredAt(root: string | undefined, name: string, wanted: string | undefined): readonly (readonly [string, number])[] {
  const read = declarations(root, name);
  if ('refused' in read) return [];
  return read.names.filter((one) => wanted === undefined || one.by === wanted).map((one) => [one.at, one.line] as const);
}

/**
 * The declarations whose names hold `query`, as the `search` section lists
 * them: the first `cap`, source first, in `files` when an area named them;
 * nothing when no checkout was named or its index could not be read.
 */
export function declaredMatches(
  root: string | undefined,
  query: string,
  files: Iterable<string> | undefined,
  cap: number,
): (Matches<DeclaredMatch> & { readonly unread: readonly string[] }) | undefined {
  const read = declarations(root, query, files === undefined ? { containing: true } : { containing: true, files });
  if ('refused' in read) return undefined;
  const shown = read.names.slice(0, cap).map((one): DeclaredMatch => ({
    source: 'declared',
    name: one.name,
    kind: one.kind,
    ...(one.by === '' ? {} : { package: one.by }),
    at: one.at,
    line: one.line,
  }));
  return { total: read.names.length, shown, unread: read.unread };
}
