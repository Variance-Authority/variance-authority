/**
 * The Help value's reading of the source index, held by the addon.
 *
 * On a large repository the value is mostly its export list — every export of
 * every file — and handing that list across as objects cost more than
 * everything done with it. So the reading keeps the list, and the path graph,
 * on the addon's side: JavaScript takes the uses it joins against the
 * documented surface, compares the list by its digest, and asks the reading to
 * publish. The search is encoded by the same code for a value JavaScript
 * already holds, which hands its list across once.
 */

// compass: variance-authority.report.agent-surface

import { native, nativeRefusal } from './native.js';
import type { NativeIndexedUsage } from './native-orient.js';
import { sourceIndexPath } from './source-index.js';

type NamedExport = NativeIndexedUsage['exported'][number];

/** The published rows of a Help value, a column per field, in `everyEntry` order. */
export interface PublishedRows {
  readonly name: string[];
  /** `specifierOf` the row's package and opening. */
  readonly spec: string[];
  readonly kind: string[];
  readonly doc: (string | null)[];
  readonly at: string[];
  readonly usedBy: number[];
  readonly uses: number[];
  /** How many sites each row has; their files follow in `sites`, row by row. */
  readonly siteCounts: number[];
  readonly sites: string[];
}

/** The published generation a search file carries in its head, so it cannot describe another checkout. */
export interface SearchGeneration {
  readonly root: string;
  readonly graphRoot: string;
  readonly graphDigest: string;
  readonly generatedAt: string;
}

/** A search file's bytes, and the digest of the export list it was encoded from. */
export interface EncodedSearch {
  readonly bytes: Uint8Array;
  readonly exported: string;
}

/** What `HelpReading.publish` writes, beside what the reading holds. */
export interface HelpPublish {
  readonly snapshot: string;
  readonly search: string;
  /** The graph is written at this prefix, its digest and `.bin`. */
  readonly graph: string;
  readonly format: string;
  readonly version: number;
  readonly root: string;
  readonly graphRoot: string;
  readonly generatedAt: string;
  /** The digest of the index manifest the reading was made from. */
  readonly indexDigest: string;
  /** JSON of the value's `packages`, `deep`, `byPath` and `unreadable`. */
  readonly packages: string;
  readonly deep: string;
  readonly byPath: string;
  readonly unreadable: string;
  readonly published: PublishedRows;
}

/** The chain's answer for a Help value; the export list stays with the addon. */
export interface HelpReading {
  /** The export list as a set, as `EncodedSearch.exported` states it. */
  readonly exportedDigest: string;
  /** The uses, deep requests and unreadable files, handed over once; `exported` is empty. */
  usage(): NativeIndexedUsage;
  /** Write the graph, the value and its search; a graph already written under its digest is kept. */
  publish(options: HelpPublish): Promise<{ readonly graphDigest: string }>;
}

export interface NativeHelp {
  readHelp?(root: string, index: string, opened: string[], published: string[], unentered: string[]): Promise<HelpReading | null>;
  encodeSearchIndex?(published: PublishedRows, exported: NamedExport[], generation: SearchGeneration | null): EncodedSearch;
  digestExported?(exported: NamedExport[]): string;
}

function entry<Name extends keyof NativeHelp>(name: Name): NonNullable<NativeHelp[Name]> {
  const scanner = native() as (NativeHelp & object) | undefined;
  const call = scanner?.[name];
  if (scanner === undefined || call === undefined) {
    throw new Error(`the Help value is read by the native scanner, and ${nativeRefusal() ?? `the scanner that loaded has no \`${name}\`; build it again`}`);
  }
  return (call as (...args: never[]) => unknown).bind(scanner) as NonNullable<NativeHelp[Name]>;
}

/**
 * The reading of the index at `index` for the entrypoints in `opened`, the
 * imports into the packages in `targets.published` that no entry opens, and
 * the packages in `targets.unentered`, which declare no entry; `null` when none
 * was published.
 */
export function readHelp(
  root: string,
  opened: readonly string[],
  targets: { readonly published: Iterable<string>; readonly unentered: Iterable<string> },
  index: string = sourceIndexPath(root),
): Promise<HelpReading | null> {
  return entry('readHelp')(root, index, [...opened], [...targets.published], [...targets.unentered]);
}

/** The search over `published` and `exported`, and the digest of `exported`. */
export function encodeSearch(published: PublishedRows, exported: readonly NamedExport[], generation?: SearchGeneration): EncodedSearch {
  return entry('encodeSearchIndex')(published, [...exported], generation ?? null);
}

/** The digest `HelpReading.exportedDigest` states, of a list JavaScript holds. */
export function exportedDigest(exported: readonly NamedExport[]): string {
  return entry('digestExported')([...exported]);
}
