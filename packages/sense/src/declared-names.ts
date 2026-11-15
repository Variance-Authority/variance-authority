/**
 * The declarations no export binds, asked of the source index the addon holds:
 * by name, by the words of their name and doc, and by the terms the loose
 * pass lets a question's words stand for.
 */

// compass: variance-authority.report.agent-surface

import { entry, onIndex } from './help-reading.js';
import type { SourceSymbolReach } from './harvest.js';
import { sourceIndexPath } from './source-index.js';

/** One declaration no export of its file binds: at its top level, inside a function, or a member of a container. */
export interface DeclaredName {
  readonly name: string;
  /** The declaration's kind as the parser harvested it: `function`, `const`, … */
  readonly kind: string;
  readonly at: string;
  /** The package whose source it is; empty at the repository root. */
  readonly by: string;
  readonly line: number;
  /** `source`, `test` or `story`, as `kindOf` says of the file. */
  readonly fileKind: 'source' | 'test' | 'story';
  /** The signature's span in the file's UTF-16 offsets, when the parser kept one. */
  readonly signatureStart?: number | null;
  readonly signatureEnd?: number | null;
  /** The doc comment's span, inside its opening and closing marks, when one is written above. */
  readonly docStart?: number | null;
  readonly docEnd?: number | null;
  /** Who can name it, as the reader of its language recorded; absent when the reader cannot tell. */
  readonly reach?: SourceSymbolReach | null;
  /** Asked by `declaredDescribedOf`: the positions, ascending, of the asked stems its name or doc holds. */
  readonly held?: readonly number[] | null;
  /** Asked by `declaredDescribedOf`: the positions, ascending, of those its name holds. */
  readonly named?: readonly number[] | null;
  /** Asked by `declaredDescribedOf`: how many of the question's adjacent word pairs its doc writes as a phrase, by `near`. */
  readonly near?: number | null;
  /** Asked by `declaredDescribedOf`: the bytes of the doc the words were held against, its lines joined by single spaces; absent when it writes none. */
  readonly docLength?: number | null;
  /** The name of the function whose body declares it, when that function has one. */
  readonly holder?: string | null;
  /** The line the function whose body declares it starts on: present only for a declaration inside a function. */
  readonly holderLine?: number | null;
  /** The container it is a member of: present only for a member. */
  readonly on?: string | null;
}

/** A file a description reached by its own name and the doc it opens with. */
export interface DescribedFile {
  readonly at: string;
  /** The package whose source it is; empty at the repository root. */
  readonly by: string;
  /** The module doc's span, inside its marks, when the file opens with one. */
  readonly docStart?: number | null;
  readonly docEnd?: number | null;
  /** The positions, ascending, of the asked stems its name or its module doc holds. */
  readonly held: readonly number[];
  /** The positions, ascending, of those its name holds. */
  readonly named: readonly number[];
  /** How many of the question's adjacent word pairs its module doc writes as a phrase. */
  readonly near: number;
  /** The bytes of the module doc the words were held against, its lines joined by single spaces; absent when it writes none. */
  readonly docLength?: number | null;
}

/** What `declaredOf` found, and the files whose declarations it could not read. */
export interface DeclaredNames {
  /** Ordered by file in code units, then by line. */
  readonly names: readonly DeclaredName[];
  /** Files whose declarations were not read — no parse, or one its reader did not harvest: unknown, not empty. */
  readonly unread: readonly string[];
  /** Asked by `declaredDescribedOf`: the files whose name and module doc hold any of the question; empty otherwise. */
  readonly files: readonly DescribedFile[];
}

/**
 * Every top-level declaration the index at `index` holds that no export of its
 * file binds — the names a file keeps to itself, which no export list holds —
 * named `query` exactly, or, given `containing`, whose name or doc comment
 * holds it in any case; only in `files`, repo-relative, when they are named. A name declared
 * twice in one file is answered once. A function inside a function answers
 * either question by its name, and a member answers `containing`, by its name,
 * its doc or `container.member`: each says what holds it. `undefined` when no index was
 * published; throws when the index does not read.
 */
export function declaredOf(
  root: string,
  query: string,
  options: { readonly containing?: boolean; readonly files?: Iterable<string> } = {},
  index: string = sourceIndexPath(root),
): DeclaredNames | undefined {
  const containing = options.containing === true;
  const files = options.files === undefined ? null : [...options.files];
  return onIndex(index, (opened) => entry('declaredOf')(root, opened, containing ? query.toLowerCase() : query, containing, files)) ?? undefined;
}

/**
 * Every top-level declaration the index at `index` holds that no export of its
 * file binds, whose name and doc comment, cut into stems by the rule
 * `describedWordsNative` cuts `query` by, hold any of `stems`, in any
 * order; only in `files`, repo-relative, when they are named.
 * Each carries the positions of the stems it holds, how many its name holds,
 * and how many of the question's adjacent word pairs its doc writes as a phrase.
 * Beside them, the files whose name and module doc hold any, the same way.
 * `undefined` when no index was published; throws when the index does not read.
 */
export function declaredDescribedOf(
  root: string,
  query: string,
  stems: readonly string[],
  files?: Iterable<string>,
  index: string = sourceIndexPath(root),
): DeclaredNames | undefined {
  return onIndex(index, (opened) => entry('declaredDescribedOf')(root, opened, query, [...stems], files === undefined ? null : [...files])) ?? undefined;
}

/** Names cut into terms: the distinct terms, sorted by their UTF-8 bytes, and per name the positions of those it holds. */
export interface NameTerms {
  readonly terms: readonly string[];
  readonly held: readonly (readonly number[])[];
}

/** `names` cut by the rule the search file cuts an exported name, for text that writes names to be asked by a name's words. */
export function nameTermsOf(names: readonly string[]): NameTerms {
  return entry('nameTerms')([...names]);
}

/**
 * The distinct search terms of every top-level name the index at `index`
 * harvested, cut as the search file cuts an exported name, in `files` when they
 * are named, sorted by their UTF-8 bytes as the search file's dictionary is.
 * `undefined` when no index was published; throws when the index does not read.
 */
export function declaredTermsOf(root: string, files?: Iterable<string>, index: string = sourceIndexPath(root)): readonly string[] | undefined {
  return onIndex(index, (opened) => entry('declaredTermsOf')(opened, files === undefined ? null : [...files])) ?? undefined;
}

/**
 * Every top-level declaration the index at `index` holds that no export of its
 * file binds, whose name's terms hold one of every group of `groups`: the
 * terms the loose pass let each word of a question stand for. `undefined` when
 * no index was published; throws when the index does not read.
 */
export function declaredLooseOf(
  root: string,
  groups: readonly (readonly string[])[],
  files?: Iterable<string>,
  index: string = sourceIndexPath(root),
): DeclaredNames | undefined {
  return onIndex(index, (opened) => entry('declaredLooseOf')(root, opened, groups.map((group) => [...group]), files === undefined ? null : [...files])) ?? undefined;
}
