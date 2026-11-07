/**
 * Where this checkout's cache is, and the share's place in it. A leaf, so
 * `share-lines` reads it without loading the record readers that read the share.
 */

import { join } from 'node:path';
import { cacheRootFor } from '@variance-authority/sense/cache-root';
import type { Config } from '../config.js';

/**
 * The cache `loadConfig` resolved, or the one this directory's repository
 * names when the config was built in code and never read from a file.
 */
export function cacheOf(config: Pick<Config, 'cacheRoot'>): string {
  return config.cacheRoot ?? cacheRootFor(process.cwd());
}

/**
 * Where a share keeps its own git repositories: one per remote, holding the
 * lines of a `git` share and the mainline history every kind asks descent of.
 */
export function shareRoot(config: Pick<Config, 'cacheRoot'>): string {
  return join(cacheOf(config), 'share');
}
