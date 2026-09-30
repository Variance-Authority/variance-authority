/**
 * Refuse a path that is in neither the recording nor the checkout.
 *
 * Git owns what the checkout holds — tracked, or new and not ignored, the set
 * the source index is scanned from — and the recording what it recorded; a path
 * in either has an answer, even if the answer is that nothing entered it. A
 * path in neither is a typo, and the nearest recorded path is named beside it.
 * Every reader that takes a path from the question asks this one function, so
 * a typo reads the same whichever command it was typed into.
 */

// compass: variance-authority.report.agent-surface

import { spawnSync } from 'node:child_process';
import { didYouMean } from '@variance-authority/mcp/tools';
import { recordedPaths } from '@variance-authority/sense';

/** Throw when `path`, a file or a directory, is in neither the recording nor the files git lists under `root`. */
export function refuseUnknownPath(root: string, path: string, recorded: () => readonly string[]): void {
  if (listed(root, path)) return;
  const bare = path.endsWith('/') ? path.slice(0, -1) : path;
  const held = recorded();
  if (held.some((known) => known === bare || known.startsWith(`${bare}/`))) return;
  throw new Error(
    `\`${path}\` is in neither the recording nor the files git lists under ${root}.` +
      `${didYouMean(bare, withDirectories(held))}`,
  );
}

/**
 * Whether git lists `path` in the checkout: tracked, or new and not ignored,
 * which is the set the source index is scanned from.
 */
function listed(root: string, path: string): boolean {
  const found = spawnSync('git', ['--literal-pathspecs', 'ls-files', '-z', '--cached', '--others', '--exclude-standard', '--', path], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 1024 * 1024 * 1024,
  });
  return found.status === 0 && found.stdout !== '';
}

/** The recording's paths under `root`, read once however many paths are asked about. */
export function recordedOnce(root: string): () => readonly string[] {
  let recorded: readonly string[] | undefined;
  return () => (recorded ??= recordedPaths(root));
}

/** Every recorded path and every directory above one, so a mistyped directory has a candidate too. */
function withDirectories(paths: readonly string[]): readonly string[] {
  const all = new Set<string>();
  for (const path of paths) {
    all.add(path);
    for (let cut = path.indexOf('/'); cut !== -1; cut = path.indexOf('/', cut + 1)) all.add(path.slice(0, cut));
  }
  return [...all];
}
