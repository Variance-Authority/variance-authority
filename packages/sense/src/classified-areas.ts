/**
 * The areas of a checkout a request's words point to: a question that reads
 * the published source-index inventory in the addon. The query reads no
 * checkout files and never refreshes the index. Only the answer crosses.
 */

// compass: variance-authority.report.agent-surface

import { entry } from './help-reading.js';
import { sourceIndexPath } from './source-index.js';
import type { SourceWalk } from './source-tree.js';

/** One area of the tree a request's words point to. */
export interface RankedArea {
  /** The directory, repository-relative; `.` for the root. */
  readonly path: string;
  /** How many files the published source index holds in it, in scope. */
  readonly files: number;
  /** The request's words it holds, as the request wrote them, the one weighing most there first. */
  readonly words: readonly string[];
  readonly score: number;
  /** Whether one of its files declares a name the source index read: only such an area is a start point the source tree holds. */
  readonly declares: boolean;
}

/** The ten areas at most, best first, and what scoped them. */
export interface ClassifiedAreas {
  readonly areas: readonly RankedArea[];
  /** How many files the start point's walks reached together; zero when none was said. */
  readonly reached: number;
  /** How many of those import something the scan could not resolve. */
  readonly unresolved: number;
  /** Why the published source index was unavailable; nothing was ranked. */
  readonly refused?: string | null;
}

/** Where {@link classifiedAreas} reads the names from, and which files it ranks. */
export interface AreasAsked {
  /**
   * Per stem of the request, in the order `describedWordsNative` gives them,
   * the help store's dictionary terms that reduce to it: what `termsOfStems`
   * resolves for `search`, so a stem admits the same terms in both.
   */
  readonly terms: readonly (readonly number[])[];
  /** The help store's bytes, which name the exported declarations; absent for a value read from no store. */
  readonly store: Uint8Array | undefined;
  /** The source index the tree was read off, which names the top-level declarations no export binds. */
  readonly index?: string;
  /** The workspace's offset below the index's root; empty when they are one. */
  readonly within?: string;
  /**
   * The start point's walks, when one was said: only the files they reached
   * together are ranked. Said and refused, it is `{}`, and nothing is.
   */
  readonly scope?: { readonly from?: SourceWalk; readonly to?: SourceWalk };
}

/**
 * The areas of the published source index's files that `query`'s words point
 * to, at most ten, scored by the request's stems their paths, their files'
 * names and the names their files declare hold, a stem fewer areas hold
 * counting for more.
 */
export function classifiedAreas(root: string, query: string, asked: AreasAsked): ClassifiedAreas {
  const { scope } = asked;
  return entry('classifyAreas')(
    root,
    query,
    asked.terms.map((terms) => [...terms]),
    asked.store ?? null,
    asked.index ?? sourceIndexPath(root),
    asked.within ?? '',
    scope !== undefined,
    scope?.from ?? null,
    scope?.to ?? null,
  );
}
