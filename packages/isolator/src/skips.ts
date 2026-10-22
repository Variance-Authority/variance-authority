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
 * the same rule as any other package.
 */

// TODO: Vitest has no seam yet; it needs a Vite plugin that calls `skipper` and `isolate`.

import { readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import picomatch from 'picomatch';

/** Whether a module at an absolute path stays as it is; `exclude` globs are relative to `root`. */
export function skipper(root: string, exclude: readonly string[] = []): (path: string) => boolean {
  const excluded = exclude.length === 0 ? () => false : picomatch(exclude as string[], { dot: true });
  const declared = sideEffects();
  return (path) => /[\\/]node_modules[\\/]/.test(path) || declared(path) || excluded(slashed(relative(root, path)));
}

/** Whether the nearest `package.json` above a module declares side effects for it. */
function sideEffects(): (path: string) => boolean {
  const byDirectory = new Map<string, (path: string) => boolean>();
  const of = (directory: string): ((path: string) => boolean) => {
    let rule = byDirectory.get(directory);
    if (rule !== undefined) return rule;
    const manifest = read(join(directory, 'package.json'));
    const parent = dirname(directory);
    rule = manifest !== undefined ? declaredBy(directory, manifest.sideEffects) : parent === directory ? () => false : of(parent);
    byDirectory.set(directory, rule);
    return rule;
  };
  return (path) => of(dirname(path))(path);
}

/** The rule one `sideEffects` field states, as bundlers read it: a pattern without a slash matches a file name at any depth. */
function declaredBy(directory: string, field: unknown): (path: string) => boolean {
  if (field === true) return () => true;
  if (!Array.isArray(field)) return () => false;
  const patterns = field.filter((pattern): pattern is string => typeof pattern === 'string').map((pattern) => (pattern.includes('/') ? pattern.replace(/^\.\//, '') : `**/${pattern}`));
  const matches = picomatch(patterns, { dot: true });
  return (path) => matches(slashed(relative(directory, path)));
}

function read(file: string): { sideEffects?: unknown } | undefined {
  try {
    return JSON.parse(readFileSync(file, 'utf8')) as { sideEffects?: unknown };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT' || (error as NodeJS.ErrnoException).code === 'ENOTDIR') return undefined;
    throw error;
  }
}

const slashed = (path: string): string => path.replaceAll('\\', '/');
