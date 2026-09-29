/** The Rust-published third-party lexicon, read by help questions. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { queryDependencyLexiconNative, refreshDependencyLexiconNative, sourceIndexPath } from '@variance-authority/sense';

export interface DependencyApiName {
  readonly name: string; readonly kind: string; readonly at: string; readonly line: number;
  readonly signature?: string; readonly doc?: string;
}
export interface DependencyIdentity { readonly name: string; readonly version: string; readonly manifest: string }
export interface DependencyApi {
  readonly runtime?: DependencyIdentity;
  readonly declarations?: DependencyIdentity;
  readonly entrypoint?: string;
  readonly names?: readonly DependencyApiName[];
  readonly sources?: readonly { readonly at: string; readonly digest: string }[];
  readonly unavailable?: string;
  /** Only on an unavailable entry: the `README.md` beside the runtime package's manifest. */
  readonly readme?: DependencyReadme;
}
export interface DependencyReadme { readonly at: string; readonly lines?: number; readonly unreadable?: string }

export interface LexiconEntry { readonly id: string; readonly api: DependencyApi }
export interface LexiconAvailability {
  readonly owner: string;
  readonly package: string;
  readonly specifier: string;
  readonly entry: string;
  readonly declared: boolean;
  readonly imported?: boolean;
}
export interface LexiconIssue { readonly owner: string; readonly package: string; readonly reason: string }
export interface DependencyLexicon {
  readonly version: 4 | 5;
  readonly refreshedAt: string;
  readonly entries: readonly LexiconEntry[];
  readonly availability: readonly LexiconAvailability[];
  readonly issues: readonly LexiconIssue[];
}

function pathOf(root: string): string { return join(dirname(sourceIndexPath(root)), 'dependency-lexicon.json'); }

/** Read the separately published corpus without scanning source or declarations. */
export function readDependencyLexicon(root: string): { readonly path: string; readonly lexicon?: DependencyLexicon } {
  const path = pathOf(root);
  try {
    const value: unknown = JSON.parse(readFileSync(path, 'utf8'));
    if (typeof value !== 'object' || value === null || ![4, 5].includes((value as Partial<DependencyLexicon>).version ?? 0)
      || !Array.isArray((value as Partial<DependencyLexicon>).entries)
      || !Array.isArray((value as Partial<DependencyLexicon>).availability)) return { path };
    return { path, lexicon: value as DependencyLexicon };
  } catch { return { path }; }
}

/** Refresh all directly available third-party solutions in the checkout. */
export function refreshDependencyLexicon(root: string) { return refreshDependencyLexiconNative(root); }

export interface ThirdPartyMatch {
  readonly source: 'third-party'; readonly name: string; readonly specifier: string;
  readonly kind: string; readonly package: string; readonly version?: string;
  readonly summary?: string; readonly imported: boolean;
  readonly at?: string; readonly line?: number; readonly signature?: string;
  readonly doc?: string; readonly declarationProvider?: string;
}
/** A package the workspace resolves that publishes no names to match, and the README it ships instead. */
export interface SilentPackage {
  readonly package: string; readonly specifier: string; readonly version?: string;
  readonly reason: string; readonly readme?: DependencyReadme; readonly imported: boolean;
}
export interface LexiconMatches {
  readonly total: number; readonly shown: readonly ThirdPartyMatch[];
  /** Present on an exact question; a lexicon written before READMEs were recorded lists the packages without one. */
  readonly silent?: readonly SilentPackage[];
}

/** Return names the native lexicon found, or absence when it is unpublished. */
export function queryDependencyLexicon(root: string, query: string, files?: readonly string[],
  exact = false, packageName?: string, limit = 20): LexiconMatches | undefined {
  const answer = queryDependencyLexiconNative(root, query, files, exact, packageName, limit);
  return answer === undefined ? undefined : JSON.parse(answer) as LexiconMatches;
}
