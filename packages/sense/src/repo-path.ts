/**
 * Which paths a scan may record, shared by discovery and resolution.
 *
 * The addon holds the same policy in `path.rs`, and the two have to agree:
 * the scan resolves JavaScript natively and stylesheets and every other
 * language here, and a file one side declines and the other records is an
 * edge that depends on which language wrote the import.
 */

import { isAbsolute, relative, sep } from 'node:path';
import type { TreeWorld } from './world.js';

/**
 * Directories a scan never descends into on disk, and never records a file
 * inside unless the tree lists it and {@link excludedWhenListed} lets it.
 */
export const EXCLUDE_DIRS = [
  'node_modules',
  'dist',
  'tsDist',
  'build',
  'coverage',
  'storybook-static',
  '.git',
  '.next',
  '.turbo',
];

/**
 * Whether a directory of this name is declined even where the tree lists what
 * is in it. `build` is the one name in {@link EXCLUDE_DIRS} that is not: a
 * tracked `build/` can be source (Docusaurus keeps its `build` command there),
 * and Git's listing is the evidence the disk cannot give. The output
 * directories stay declined either way, because what an import of them means is
 * decided by the configuration that emits them.
 */
export function excludedWhenListed(name: string): boolean {
  return name !== 'build' && EXCLUDE_DIRS.includes(name);
}

/**
 * A path inside the repository, relative and slash-separated, or nothing.
 *
 * A path under `build/` answers only when `listed` holds it. A scan passes its
 * tree, which is Git's listing, so an import lands on every file the scan
 * would read and on nothing the disk alone put there.
 */
export function toRepoPath(
  root: string,
  absolute: string,
  listed?: Pick<TreeWorld, 'has'>,
): string | undefined {
  const path = relative(root, absolute);
  if (path === '' || path.startsWith('..') || isAbsolute(path)) return undefined;

  const normalized = sep === '/' ? path : path.split(sep).join('/');
  const parts = normalized.split('/');
  if (parts.some(excludedWhenListed)) return undefined;

  return parts.some(excluded) && listed?.has(normalized) !== true ? undefined : normalized;
}

/**
 * Whether a repository path is recorded only on a listing's word: it sits
 * under a `build/`, and under nothing declined outright.
 */
export function onlyListed(path: string): boolean {
  const parts = path.split('/');
  return parts.some(excluded) && !parts.some(excludedWhenListed);
}

function excluded(name: string): boolean {
  return EXCLUDE_DIRS.includes(name);
}
