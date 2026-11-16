/** Where Jest keeps its transform cache, as the project's own Jest answers it. */

import { createRequire } from 'node:module';
import { jestDependency } from './jest-dependency.js';

/**
 * Jest's default cache directory: `defaults.cacheDirectory` of the `jest-config`
 * the project's Jest resolves, the copy its runs read. A config naming a
 * `cacheDirectory` of its own is not read: loading a project's config costs
 * its transpiler, and the default is what most projects leave.
 */
export function jestCacheDirectory(rootDir: string): { readonly directory: string } | { readonly unknown: string } {
  let config: string;
  try {
    config = jestDependency(rootDir, 'jest-config');
  } catch {
    return { unknown: `jest-config does not resolve from ${rootDir}` };
  }
  let directory: unknown;
  try {
    // No import names the project's jest-config: it is the copy its Jest resolves.
    directory = (createRequire(config)(config) as { defaults?: { cacheDirectory?: unknown } }).defaults?.cacheDirectory;
  } catch (error) {
    return { unknown: `${config} does not load (${error instanceof Error ? error.message : String(error)})` };
  }
  if (typeof directory !== 'string' || directory === '') return { unknown: `${config} names no defaults.cacheDirectory` };
  return { directory };
}
