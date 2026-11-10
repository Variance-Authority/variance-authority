/**
 * Where a Jest configuration's entries are on disk: a project's `rootDir`, and
 * the setup, environment and trace entries that name files rather than packages.
 */

import { isAbsolute, resolve } from 'node:path';
import type { JestConfig } from './jest.js';

/** `jest-resolve`'s `findNodeModule`. */
export type FindNodeModule = (path: string, options: { basedir: string; extensions?: readonly string[]; resolver?: string }) => string | null;

/** A project's `rootDir`, absolute, with the top level's `<rootDir>` spelled out; the top level's own when it has none. */
export function projectRoot(project: JestConfig, root: string): string {
  return resolve(root, (project.rootDir ?? '.').replace(/^<rootDir>\/?/, ''));
}

/**
 * Whether Jest reads this `rootDir` from the config file, whose directory the
 * wrap is never told. An absolute one is Jest's as written, and with none the
 * wrap gives Jest its own `root`.
 */
export function readFromConfigFile(config: JestConfig): boolean {
  return config.rootDir !== undefined && !isAbsolute(config.rootDir);
}

/**
 * The `rootDir` of a configuration with no `projects`, under the wrap's `root`:
 * only an absolute one is taken over `root`.
 */
export function ownRoot(config: JestConfig, root: string): string {
  return config.rootDir === undefined || readFromConfigFile(config) ? root : resolve(config.rootDir);
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
