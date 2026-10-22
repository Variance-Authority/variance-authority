/**
 * Which modules a seam hands over untouched, the same for every runner and
 * bundler: this package's own runtime, anything under `node_modules`, and the
 * globs the user names in `exclude`. A seam adds only what its runner answers
 * itself, as Jest does for its test files.
 */

// TODO: Vitest has no seam yet; it needs a Vite plugin that calls `skipper` and `isolate`.

import { relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import picomatch from 'picomatch';

// The runtime every isolated module imports sits beside this file, and must
// stay one per realm. A linked workspace resolves it outside `node_modules`.
const own = fileURLToPath(new URL('.', import.meta.url));

/** Whether a module at an absolute path stays as it is; `exclude` globs are relative to `root`. */
export function skipper(root: string, exclude: readonly string[] = []): (path: string) => boolean {
  const excluded = exclude.length === 0 ? () => false : picomatch(exclude as string[], { dot: true });
  return (path) => path.startsWith(own) || /[\\/]node_modules[\\/]/.test(path) || excluded(relative(root, path).replaceAll('\\', '/'));
}
