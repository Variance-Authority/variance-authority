/**
 * Where a Jest configuration's entries are on disk: a project's `rootDir`, the
 * setup, environment and trace entries that name files rather than packages,
 * and the packages Jest itself depends on.
 */

import { createRequire } from 'node:module';
import { isAbsolute, resolve } from 'node:path';
import type { JestConfig } from './jest.js';

/** `jest-resolve`'s `findNodeModule`. */
export type FindNodeModule = (path: string, options: { basedir: string; extensions?: readonly string[]; resolver?: string }) => string | null;

/** The packages a dependency of Jest is reached through, from the outside in. */
const JEST_CHAIN = ['jest', '@jest/core', 'jest-config'] as const;

/**
 * Where a package Jest depends on is. Jest resolves it from `jest-config`, not
 * from the project: under pnpm or any layout that does not hoist it, the project
 * cannot resolve it. So it is looked for from the project, then from each
 * package on Jest's path to it.
 */
export function jestDependency(rootDir: string, name: string): string {
  let from = resolve(rootDir, 'package.json');
  for (const next of [...JEST_CHAIN, undefined]) {
    const require = createRequire(from);
    try {
      return require.resolve(name);
    } catch (error) {
      if (next === undefined) throw error;
      try {
        from = require.resolve(next);
      } catch {
        throw error;
      }
    }
  }
  throw new Error(`unreachable: ${name}`);
}

/** A project's `rootDir`, absolute, with the top level's `<rootDir>` spelled out; the top level's own when it has none. */
export function projectRoot(project: JestConfig, root: string): string {
  return resolve(root, (project.rootDir ?? '.').replace(/^<rootDir>\/?/, ''));
}

/**
 * The `rootDir` of a configuration with no `projects`, under the wrap's `root`.
 * Jest reads a relative one from the config file, whose directory the wrap is
 * never told, so only an absolute one is taken over `root`.
 */
export function ownRoot(config: JestConfig, root: string): string {
  return config.rootDir !== undefined && isAbsolute(config.rootDir) ? resolve(config.rootDir) : root;
}

/**
 * The setup entries that are files of the project's, as absolute paths.
 *
 * Jest resolves a setup entry the way `require` would: `<rootDir>/…`, `./…`
 * and `/…` are paths, and anything else — `jest-canvas-mock`, `dotenv/config`
 * — is a package. A package is not a precondition a diff can carry, and
 * reading it as a path is a missing file that fails the reporter and loses the
 * run's snapshot entirely.
 */
export function setupPaths(config: JestConfig, rootDir: string): readonly string[] {
  return [...(config.setupFiles ?? []), ...(config.setupFilesAfterEnv ?? [])]
    .flatMap((file) => configuredPath(file, rootDir));
}

/** Resolve one configuration entry only when it names a file rather than a package. */
export function configuredPath(file: string, rootDir: string): readonly string[] {
  return file.startsWith('<rootDir>') || file.startsWith('.') || file.startsWith('/')
    ? [resolve(rootDir, file.replace(/^<rootDir>\/?/, ''))]
    : [];
}
