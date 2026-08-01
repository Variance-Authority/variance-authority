import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { indexSource, mergeSourceIndexes, type SourceIndex } from '@variance-authority/core';

/**
 * This example's own source, indexed by component name.
 *
 * Built by reading the repository rather than by instrumenting a build. That is
 * the point rather than an expedient: React 19 removed `_debugSource`, so
 * per-element source is a compile-plugin story nothing tells — and a link that
 * only works on projects which have already adopted a plugin is a link that
 * works on no project before adoption.
 *
 * Shared between the semantic report and the raster one because both ask the
 * same question. Attribution names components; a component-to-file index answers
 * it, whether the change was sensed in a tree or in a bitmap.
 */

/**
 * Resolved from the working directory rather than `import.meta.url`.
 *
 * Under Vitest the module URL points into the transform pipeline, not at the
 * file on disk, so deriving a source root from it lands somewhere that does not
 * exist. The suite runs from the workspace root — asserted here so a wrong cwd
 * fails with a sentence rather than an ENOENT on a path nobody recognises.
 */
export const PACKAGE_ROOT = join(process.cwd(), 'examples/todomvc');

export function buildSourceIndex(): SourceIndex {
  if (!existsSync(join(PACKAGE_ROOT, 'src'))) {
    throw new Error(`expected the workspace root as cwd; ${PACKAGE_ROOT} has no src/`);
  }

  const files: string[] = [];
  const walk = (directory: string): void => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const full = join(directory, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.tsx?$/.test(entry.name) && !entry.name.includes('.test.')) files.push(full);
    }
  };
  walk(join(PACKAGE_ROOT, 'src'));

  return mergeSourceIndexes(
    files.map((file) => indexSource(relative(PACKAGE_ROOT, file), readFileSync(file, 'utf8'))),
  );
}
