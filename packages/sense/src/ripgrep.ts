/** ripgrep's search, run in the addon over files a question already chose. */
import { native, nativeRefusal } from './addon.js';

// compass: variance-authority.report.agent-surface

/**
 * Every line of `files`, relative to `root`, that ripgrep's pattern matches, in
 * the order the files were asked, and one complaint per file it could not read.
 * The search is ripgrep's own crates, linked into the addon, so no `rg` is run.
 */
export function ripgrepNative(root: string, pattern: string, files: readonly string[]) {
  const addon = native();
  if (addon === undefined) throw new Error(`text search requires the native scanner: ${nativeRefusal() ?? 'it is unavailable'}`);
  return addon.ripgrep(root, pattern, [...files]);
}
