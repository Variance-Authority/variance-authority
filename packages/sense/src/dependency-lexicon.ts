/** The native lexicon writer; only its aggregate result crosses the boundary. */
import { join, dirname } from 'node:path';
import { native, nativeRefusal } from './native.js';
import { sourceIndexPath } from './source-index.js';
import { declaredTsconfig } from './typescript.js';

/** The lexicon's two files beside the source index: the catalogue, and the requests each source file writes. */
function lexiconPaths(root: string): readonly [catalogue: string, sites: string] {
  const directory = dirname(sourceIndexPath(root));
  return [join(directory, 'dependency-lexicon.bin'), join(directory, 'dependency-lexicon.sites.bin')];
}

/** Publish the installed dependency API corpus and return aggregate counts. */
export function refreshDependencyLexiconNative(root: string) {
  const addon = native();
  if (addon === undefined) throw new Error(`the dependency lexicon requires the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  const [catalogue, sites] = lexiconPaths(root);
  // A package resolves where the scan that built the index resolved it.
  return addon.refreshDependencyLexicon(root, sourceIndexPath(root), catalogue, sites, declaredTsconfig(root));
}

/** Ask the native lexicon for a bounded set of names. */
export function queryDependencyLexiconNative(root: string, query: string, files?: readonly string[],
  exact = false, packageName?: string, limit = 20): string | undefined {
  const addon = native();
  if (addon === undefined) throw new Error(`the dependency lexicon requires the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  const [catalogue, sites] = lexiconPaths(root);
  return addon.queryDependencyLexicon(catalogue, sites, query, files === undefined ? null : [...files], exact, packageName ?? null, limit) ?? undefined;
}

/** Ask the native lexicon for every package usable at `files`, one page of it. */
export function dependencyStackNative(root: string, files: readonly string[], offset: number, limit: number): string | undefined {
  const addon = native();
  if (addon === undefined) throw new Error(`the dependency lexicon requires the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  const [catalogue, sites] = lexiconPaths(root);
  return addon.dependencyStack(catalogue, sites, [...files], offset, limit) ?? undefined;
}

/**
 * A question's distinct stems, each with the word it was written as, split
 * the way a package's words are, so the repository's own names are asked by
 * the words its dependencies are, with the words every package says about
 * itself — `package`, `module`, `use` and the like — kept, since code is
 * named in them.
 */
export function describedWordsNative(query: string): readonly (readonly [stem: string, word: string])[] {
  const addon = native();
  if (addon === undefined) throw new Error(`described words require the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  return addon.describedWords(query);
}

/** Per text, how many of the adjacent word pairs of `query` it writes adjacent: a doc that says the question's phrase. */
export function nearOfNative(query: string, texts: readonly string[]): readonly number[] {
  const addon = native();
  if (addon === undefined) throw new Error(`nearness requires the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  return addon.nearOf(query, [...texts]);
}

/** Each word reduced to its stem, in order: the rule `describedWordsNative` stems a question by. */
export function wordStemsNative(words: readonly string[]): readonly string[] {
  const addon = native();
  if (addon === undefined) throw new Error(`word stems require the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  return addon.wordStems([...words]);
}
