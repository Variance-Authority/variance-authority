// compass: variance-authority.reach
/**
 * A manifest that moved, read as the package it describes.
 *
 * A `package.json` whose `exports`, `main` or `type` moved changes how every
 * file of its package loads without changing a line of any of them, so each
 * reader of a change counts those files as changed: the graph walk as files,
 * the journal as whole-file entries.
 */

import { nodesOfKind, within, type Relations } from '@variance-authority/core/relate';
import type { InstallDiff } from './installed.js';

/**
 * The files of every package whose manifest moved, from the graph.
 *
 * The directory of a moved `package.json` is expanded the way a monorepo tool's
 * changed directory is: every file the graph holds under it. A moved manifest
 * the graph holds no file beside is returned in `unplaced`, to be read as the
 * ordinary changed path it would have been — a gap under the scanned roots, a
 * file nothing reads outside them — rather than as a package that reached
 * nothing.
 */
export function movedPackages(
  relations: Relations,
  install: InstallDiff | undefined,
): { readonly files: readonly string[]; readonly unplaced: readonly string[] } {
  const moved = install === undefined || 'whole' in install ? [] : install.moved;
  if (moved.length === 0) return { files: [], unplaced: [] };
  const names = nodesOfKind(relations, 'file').map((id) => relations.names[id]!);
  const files = new Set<string>();
  const unplaced: string[] = [];
  for (const manifest of moved) {
    const beside = names.filter((file) => within(file, [directoryOf(manifest)]));
    if (beside.length === 0) unplaced.push(manifest);
    for (const file of beside) files.add(file);
  }
  return { files: [...files].sort(byCodeUnit), unplaced };
}

/**
 * A patch that also changes, whole, every file of a package whose manifest
 * moved — the journal's reading of {@link movedPackages}.
 *
 * A file named with no hunk is every recorded region of it, and a file with no
 * row is answered by its recorded importers, so a package whose `exports`
 * moved selects every test that entered it or anything importing it, which is
 * what the walk's changed directory selects.
 */
export function withMovedPackages(diff: string, files: readonly string[]): string {
  if (files.length === 0) return diff;
  return [diff, ...files.map((file) => `diff --git a/${file} b/${file}`)].join('\n');
}

function directoryOf(file: string): string {
  const at = file.lastIndexOf('/');
  return at === -1 ? '.' : file.slice(0, at);
}

function byCodeUnit(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
