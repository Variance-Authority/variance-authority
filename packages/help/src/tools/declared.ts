/**
 * Names a file declares and does not export, answered rather than refused.
 *
 * Every export list stops at what a file hands out, and a file keeps most of
 * what it declares to itself: the helper a function calls, the constant beside
 * it. A caller who typed such a name exactly is not wrong about the name, and
 * `git grep` would find it at once. The source index harvested every top-level
 * declaration of every file it parsed, and every function a function's body
 * declares, so the declaration is read from there,
 * with who can reach it, as the reader of its language recorded: an ES
 * module's own name, and a Swift or Kotlin `private` one, is its file's alone,
 * a Rust item that is not `pub` is its module's and the modules inside it, and
 * a Python module keeps no name from an import that spells it, and a closure is
 * its holder's alone. A reader that
 * cannot tell — a script, a `macro_rules!` — records nothing, and the answer
 * says that.
 */

// compass: variance-authority.report.agent-surface

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { declaredOf, type DeclaredName } from '@variance-authority/sense';
import { docOf, headOf } from '../indexed-surface.js';
import type { DeclaredMatch, Matches } from './search-answer.js';

/** How many declarations of one name `symbol` writes out before it counts the rest. */
const DECLARED_CAP = 5;

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
 * and who can reach it. The signature and the
 * documentation are left out when the file no longer holds the name where the
 * index read it.
 */
function declaredBlock(root: string, held: DeclaredName): string {
  const text = textAt(root, held);
  const signature = text === undefined ? undefined : headOf(text, spanOf(held.signatureStart, held.signatureEnd));
  const doc = text === undefined ? undefined : docOf(text, spanOf(held.docStart, held.docEnd));
  return [
    `${held.name} [${held.kind}]`,
    `declared, not exported, at ${held.at}:${held.line}${held.by === '' ? '' : ` by ${held.by}`}`,
    ...(signature === undefined ? [] : [signature]),
    ...(doc === undefined ? [] : [doc]),
    reachSentences(held).block,
  ].join('\n');
}

/**
 * Who can reach a name its file declares and does not export, as its reader
 * recorded: the sentence `symbol` ends a declaration with, and the clause `uses`
 * ends its line with.
 */
export function reachSentences(held: Pick<DeclaredName, 'at' | 'name' | 'reach'>): { readonly block: string; readonly clause: string } {
  const { at, name } = held;
  switch (held.reach) {
    case 'file':
      return {
        block: `Nothing outside ${at} can import it: no export of that file names it.`,
        clause: ', so nothing outside that file can import it',
      };
    case 'module':
      return {
        block: 'Only the module it is declared in, and the modules inside that one, can name it: it is not `pub`.',
        clause: ', so only its module and the modules inside it can name it',
      };
    case 'underscore':
    case 'all': {
      const kept = held.reach === 'underscore' ? 'a leading underscore' : '`__all__`';
      return {
        block: `Another module can still import it by name: ${kept} keeps it out of \`from … import *\` only.`,
        clause: `; another module can still import it by name, which \`ask grep --query '\\b${name}\\b' --to ${at}\` finds`,
      };
    }
    case 'scope': {
      const holder = held.name.slice(0, held.name.lastIndexOf('::')).split('::').at(-1) ?? '';
      return {
        block: `Only \`${holder}\` can name it: it is declared inside \`${holder}\`.`,
        clause: `, so only \`${holder}\` can name it: it is declared inside \`${holder}\``,
      };
    }
    default:
      return {
        block: 'Who can reach it is not recorded: its reader cannot tell how this file hands it out.',
        clause: '; who can reach it is not recorded',
      };
  }
}

/** One declaration, as a `search` line writes it. */
export function declaredLine(held: DeclaredMatch): string {
  return `${held.name} [${held.kind}] — ${held.package ?? 'the repository'} · ${held.at}:${held.line}`;
}

/** How many unread files `unreadLine` names before it counts the rest. */
const UNREAD_NAMED = 3;

/**
 * The sentence that says some files' declarations were not read, and which,
 * or nothing when every file's were. Indexing again reads none of them: a file
 * is declined by its size or its bytes, or its reader did not harvest it.
 */
export function unreadLine(unread: readonly string[]): readonly string[] {
  if (unread.length === 0) return [];
  const files = unread.length === 1 ? '1 file' : `${unread.length} files`;
  const named = unread.slice(0, UNREAD_NAMED).join(', ');
  const more = unread.length - UNREAD_NAMED;
  return [
    `The declarations of ${files} were not read into the source index, so a name declared there is not known: ${named}${more > 0 ? ` and ${more} more` : ''}.`,
  ];
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
  // The line spells the item's own name: one inside a Rust inline module is
  // declared as `tests::fixture` and written `fn fixture`.
  const own = held.name.split('::').at(-1)!;
  return text.split(/\r?\n/)[held.line - 1]?.includes(own) === true ? text : undefined;
}

/**
 * The blocks `symbol` answers a name's file-private declarations with — alone
 * when no file exports it, after the exports when another file does: one per
 * declaration, source first and nearest a path in `from` first, the first
 * `DECLARED_CAP` of them, each of the rest at its line, and the files whose
 * declarations were not read; nothing when the
 * source index is not at hand, since a name nothing exports is then unknown.
 */
export function declaredBlocks(
  root: string | undefined,
  name: string,
  wanted: string | undefined,
  from: readonly string[] = [],
): readonly string[] {
  const read = declarations(root, name);
  if (root === undefined || 'refused' in read) return [];
  const held = nearestFirst(
    read.names.filter((one) => wanted === undefined || one.by === wanted),
    from,
  );
  if (held.length === 0) return [];
  const rest = held.slice(DECLARED_CAP);
  const named = rest.slice(0, DECLARED_NAMED).map((one) => `${one.at}:${one.line}`);
  const unnamed = rest.length - named.length;
  return [
    ...held.slice(0, DECLARED_CAP).map((one) => declaredBlock(root, one)),
    ...(rest.length > 0
      ? [`${rest.length} more ${rest.length === 1 ? 'declaration' : 'declarations'} of \`${name}\` not written out: ${named.join(', ')}${unnamed > 0 ? ` and ${unnamed} more` : ''}.`]
      : []),
    ...unreadLine(read.unread),
  ];
}

/** How many of the declarations past `DECLARED_CAP` are named, at their line, before the rest are counted. */
const DECLARED_NAMED = 50;

/**
 * The declarations, those in a file nearest one of `from` first: the more
 * leading path segments they share, the nearer. Stable, so the source-first
 * order holds among equals; no `from` leaves the order as it is.
 */
function nearestFirst(held: readonly DeclaredName[], from: readonly string[]): readonly DeclaredName[] {
  if (from.length === 0) return held;
  const near = (at: string): number => Math.max(...from.map((one) => shared(at, one)));
  return held.map((one) => [one, near(one.at)] as const).sort((left, right) => right[1] - left[1]).map(([one]) => one);
}

/** How many leading path segments two repository-relative paths share; a file and itself share one more than its segments. */
function shared(left: string, right: string): number {
  const a = left.split('/');
  const b = right.replace(/\/+$/u, '').split('/');
  let count = 0;
  while (count < a.length && count < b.length && a[count] === b[count]) count += 1;
  return count === a.length && count === b.length ? count + 1 : count;
}

/** The file-private declarations of the name, source first; none when the index is not at hand. */
export function declaredAt(root: string | undefined, name: string, wanted: string | undefined): readonly DeclaredName[] {
  const read = declarations(root, name);
  if ('refused' in read) return [];
  return read.names.filter((one) => wanted === undefined || one.by === wanted);
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
  return { total: read.names.length, shown: read.names.slice(0, cap).map(declaredMatch), unread: read.unread };
}

/** One declaration, as a `search` section holds it. */
export const declaredMatch = (one: DeclaredName): DeclaredMatch => ({
  source: 'declared',
  name: one.name,
  kind: one.kind,
  ...(one.by === '' ? {} : { package: one.by }),
  at: one.at,
  line: one.line,
});
