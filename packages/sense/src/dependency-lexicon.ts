/** The native lexicon writer; only its aggregate result crosses the boundary. */
import { join, dirname } from 'node:path';
import { native, nativeRefusal } from './native.js';
import { sourceIndexPath } from './source-index.js';

/** Publish the installed dependency API corpus and return aggregate counts. */
export function refreshDependencyLexiconNative(root: string) {
  const addon = native();
  if (addon === undefined) throw new Error(`the dependency lexicon requires the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  const index = sourceIndexPath(root);
  return addon.refreshDependencyLexicon(root, index, join(dirname(index), 'dependency-lexicon.json'), new Date().toISOString());
}

/** Ask the native lexicon for a bounded set of names. */
export function queryDependencyLexiconNative(root: string, query: string, files?: readonly string[],
  exact = false, packageName?: string, limit = 20): string | undefined {
  const addon = native();
  if (addon === undefined) throw new Error(`the dependency lexicon requires the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  const path = join(dirname(sourceIndexPath(root)), 'dependency-lexicon.json');
  return addon.queryDependencyLexicon(path, query, files === undefined ? null : [...files], exact, packageName ?? null, limit) ?? undefined;
}
