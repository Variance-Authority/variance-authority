/**
 * Refuse a path that is in neither the recording nor the checkout.
 *
 * Git owns what the checkout holds — tracked, or new and not ignored, the set
 * the source index is scanned from — and the recording what it recorded; a path
 * in either has an answer, even if the answer is that nothing entered it. A
 * path in neither is a typo, and the nearest recorded path is named beside it,
 * or, when none is one typo away, the recorded files that carry its name.
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
      `${didYouMean(bare, withDirectories(held)) || sameName(bare, held)}`,
  );
}

/** How many recorded paths of the same name a refusal names before it counts the rest. */
const NAMED = 5;

/**
 * The recorded files that share the last segment of `path`, for a path typed
 * under the wrong directory: too far from any recorded path for one edit to
 * reach, and the name is the part that was right.
 */
function sameName(path: string, held: readonly string[]): string {
  const name = path.slice(path.lastIndexOf('/') + 1);
  const found = held.filter((known) => known.slice(known.lastIndexOf('/') + 1) === name).sort();
  if (found.length === 0) return '';
  const shown = found.slice(0, NAMED).map((known) => `\`${known}\``);
  const more = found.length - shown.length;
  const listed = more > 0 ? `${shown.join(', ')} and ${more} more` : shown.length === 1 ? shown[0] : `${shown.slice(0, -1).join(', ')} and ${shown.at(-1)}`;
  return `\nThe recording holds \`${name}\` at ${listed}.`;
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
