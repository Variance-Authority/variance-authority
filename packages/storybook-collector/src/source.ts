import { readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { indexSource, mergeSourceIndexes, type SourceIndex } from '@variance-authority/core';

import { operatorError } from './operator.js';

/**
 * Component to `file:line`, by scanning the project's own source.
 *
 * A regex scan rather than a plugin, and the reason is the same one the whole
 * project keeps arriving at: an index built from the source that shipped is a
 * fact about the repository, while an index built by a build step is a fact
 * about a build somebody has to keep configured. `resolveSource` is the last hop
 * of attribution, so getting it from the cheapest possible place is what makes
 * `file:line` free rather than a feature.
 *
 * **Directories, not globs.** A glob syntax is a small language with its own
 * bugs, and the question here is only *which files hold components* — which a
 * directory and a set of extensions answers. Nothing is installed to ask it.
 */

export interface SourceScan {
  /** Directories to walk, relative to `root` or absolute. */
  readonly dirs: readonly string[];
  /** Defaults to `.tsx`, `.jsx`, `.ts`, `.js`. */
  readonly extensions?: readonly string[];
  /** Skipped anywhere in a path. Defaults to tests, stories and `node_modules`. */
  readonly exclude?: readonly string[];
}

const EXTENSIONS = ['.tsx', '.jsx', '.ts', '.js'];
const EXCLUDE = ['node_modules', '.test.', '.spec.', '.stories.', 'dist/', 'storybook-static'];

function walk(dir: string, into: string[]): string[] {
  let entries: { name: string; isDirectory(): boolean }[];
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch {
    // A directory that is not there is a configuration mistake worth reporting,
    // and reporting it is `scanSource`'s job — it can say which of several was
    // missing, and this one cannot.
    return into;
  }

  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) walk(path, into);
    else into.push(path);
  }
  return into;
}

export function scanSource(root: string, scan: SourceScan): SourceIndex {
  const extensions = scan.extensions ?? EXTENSIONS;
  const exclude = scan.exclude ?? EXCLUDE;

  const files = scan.dirs
    .flatMap((dir) => walk(join(root, dir), []))
    .filter((file) => extensions.some((extension) => file.endsWith(extension)))
    .filter((file) => !exclude.some((fragment) => file.includes(fragment)));

  // Empty is reported rather than returned. An index with nothing in it produces
  // a report whose every component resolves to no file — which reads exactly like
  // a project whose components are anonymous, and is instead a mistyped path.
  if (files.length === 0) {
    throw operatorError(
      `no source files under ${scan.dirs.join(', ')} (from ${root}) matching ` +
        `${extensions.join(', ')}; every component would resolve to no file`,
    );
  }

  return mergeSourceIndexes(
    files.map((file) => indexSource(relative(root, file), readFileSync(file, 'utf8'))),
  );
}
