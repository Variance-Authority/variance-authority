/**
 * Which modules a seam hands over untouched, the same for every runner and
 * bundler: anything under `node_modules`, every module its package declares
 * side effects for in `sideEffects`, and the globs the user names in
 * `exclude`. A seam adds only what its runner answers itself, as Jest does for
 * its test files.
 *
 * A module with side effects does something when it loads that has to stay
 * done — registering, installing a reset — so it belongs to every session.
 * This package and `@variance-authority/ioc` declare theirs, and are left by
 * the same rule as any other package. Sense reads the field, the one reader
 * test selection asks too, so a pattern naming built output leaves its source.
 */

// TODO: Vitest has no seam yet; it needs a Vite plugin that calls `skipper` and `isolate`.

import { relative } from 'node:path';
import { declaresSideEffects } from '@variance-authority/sense/side-effects';
import picomatch from 'picomatch';

/** Whether a module at an absolute path stays as it is; `exclude` globs are relative to `root`. */
export function skipper(root: string, exclude: readonly string[] = []): (path: string) => boolean {
  const excluded = exclude.length === 0 ? () => false : picomatch(exclude as string[], { dot: true });
  // Jest asks twice for each module, once for its cache key and once to
  // transform it, and the native read walks the module's manifests each time.
  const verdicts = new Map<string, boolean>();
  return (path) => {
    let skipped = verdicts.get(path);
    if (skipped === undefined) {
      skipped = /[\\/]node_modules[\\/]/.test(path) || excluded(relative(root, path).replaceAll('\\', '/')) || declaresSideEffects([path]).length > 0;
      verdicts.set(path, skipped);
    }
    return skipped;
  };
}
