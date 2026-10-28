/**
 * Where a Jest configuration's entries are on disk: a project's `rootDir`, and
 * the setup, environment and trace entries that name files rather than packages.
 */

import { resolve } from 'node:path';
import type { JestConfig } from './jest.js';

/** A project's `rootDir`, absolute, with the top level's `<rootDir>` spelled out; the top level's own when it has none. */
export function projectRoot(project: JestConfig, root: string): string {
  return resolve(root, (project.rootDir ?? '.').replace(/^<rootDir>\/?/, ''));
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

/** A custom environment runs before `setupFiles`, so it is an input and never probed source. */
export function environmentPaths(config: JestConfig, rootDir: string): readonly string[] {
  return config.testEnvironment === undefined ? [] : configuredPath(config.testEnvironment, rootDir);
}

/** Resolve one configuration entry only when it names a file rather than a package. */
export function configuredPath(file: string, rootDir: string): readonly string[] {
  return file.startsWith('<rootDir>') || file.startsWith('.') || file.startsWith('/')
    ? [resolve(rootDir, file.replace(/^<rootDir>\/?/, ''))]
    : [];
}
