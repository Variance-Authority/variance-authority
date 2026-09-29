/** The Rust-published third-party lexicon, read by help questions. */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { dependencyStackNative, queryDependencyLexiconNative, refreshDependencyLexiconNative, sourceIndexPath } from '@variance-authority/sense';

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
  /** How the owning manifest declares it; absent when it only imports it. */
  readonly declaredAs?: 'dependency' | 'optional' | 'peer' | 'dev';
  /** Written requests for the specifier under the owner, and the first of them as `file:line`. */
  readonly imports?: number;
  readonly site?: string;
}
export interface LexiconIssue { readonly owner: string; readonly package: string; readonly reason: string }
export interface DependencyLexicon {
  readonly version: 4 | 5 | 6 | 7;
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
    if (typeof value !== 'object' || value === null || ![4, 5, 6, 7].includes((value as Partial<DependencyLexicon>).version ?? 0)
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
  /** The manifest this hit is offered under. */
  readonly manifest: string;
  /** How that manifest declares the package; absent when it only imports it. */
  readonly declaredAs?: 'dependency' | 'optional' | 'peer' | 'dev';
  /** Written imports of the specifier under that manifest; absent when no source index was read. */
  readonly imports?: number;
  /** The first of them, `file:line`. */
  readonly site?: string;
  readonly summary?: string; readonly imported: boolean;
  readonly at?: string; readonly line?: number; readonly signature?: string;
  readonly doc?: string; readonly declarationProvider?: string;
}
/** A package the workspace resolves that publishes no names to match, and the README it ships instead. */
export interface SilentPackage {
  readonly package: string; readonly specifier: string; readonly version?: string;
  readonly reason: string; readonly readme?: DependencyReadme; readonly imported: boolean;
}
/** What a question searched: the manifests it read and how many distinct packages they offered. */
export interface LexiconScope {
  readonly owners: readonly string[]; readonly packages: number;
  /** The manifests that own the paths the question stood at; absent when it stood nowhere. */
  readonly location?: readonly string[];
}
/** A package whose own words, or the words of its names, hold what a described job asked for. */
export interface DescribedPackage {
  readonly package: string; readonly specifier: string; readonly version?: string;
  readonly manifest: string; readonly declaredAs?: 'dependency' | 'optional' | 'peer' | 'dev';
  readonly imports?: number; readonly site?: string; readonly imported: boolean;
  /** The question's words the package holds. */
  readonly words: readonly string[];
  /** How many of them the package says about itself rather than through a name. */
  readonly said: number;
  readonly description?: string;
}
export interface LexiconMatches {
  readonly total: number; readonly shown: readonly ThirdPartyMatch[];
  readonly scope: LexiconScope;
  /** Present on an exact question; a lexicon written before READMEs were recorded lists the packages without one. */
  readonly silent?: readonly SilentPackage[];
  /** Present on a question by words: the packages that describe it, best first, under a lexicon that recorded what packages say. */
  readonly described?: readonly DescribedPackage[];
  readonly describedTotal?: number;
}

/** Return names the native lexicon found, or absence when it is unpublished. */
export function queryDependencyLexicon(root: string, query: string, files?: readonly string[],
  exact = false, packageName?: string, limit = 20): LexiconMatches | undefined {
  const answer = queryDependencyLexiconNative(root, query, files, exact, packageName, limit);
  return answer === undefined ? undefined : JSON.parse(answer) as LexiconMatches;
}

/** One package usable at a location, as the owning manifest reads it. */
export interface StackRow {
  readonly package: string; readonly manifest: string;
  readonly role: 'runtime' | 'dev' | 'types-only';
  readonly declaredAs?: 'dependency' | 'optional' | 'peer' | 'dev';
  readonly version?: string;
  /** `unread` when the source index was not read for the owner, which is not the same as no imports. */
  readonly state: 'imported' | 'unused' | 'unread';
  readonly imports?: number; readonly site?: string; readonly specifiers: number;
}
export interface Stack {
  readonly location: readonly string[]; readonly total: number;
  readonly imported: number; readonly unused: number; readonly unread: number;
  readonly offset: number; readonly remaining: number;
  readonly rows: readonly StackRow[];
  readonly unreadable: readonly { readonly manifest: string; readonly package: string; readonly reason: string }[];
}

/** Every package usable at `files`, imported first, one page; absent when the lexicon is unpublished. */
export function dependencyStack(root: string, files: readonly string[], offset = 0, limit = 40): Stack | undefined {
  const answer = dependencyStackNative(root, files, offset, limit);
  return answer === undefined ? undefined : JSON.parse(answer) as Stack;
}
