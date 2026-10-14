/**
 * The two Rspack loaders of the Rstest seam, by absolute path, and the refusal
 * of a configuration that carries the first without the second. Kept apart from
 * either loader so neither entry publishes them.
 */

import { basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { projectPath } from './instrumented-modules.js';

/** The loader that cuts test files before SWC, by absolute path. */
export const SELECTION_LOADER = fileURLToPath(new URL('./rstest-loader.js', import.meta.url));

/** The loader that probes what the project's loaders wrote, by absolute path. */
export const AFTER_LOADER = fileURLToPath(new URL('./rstest-after-loader.js', import.meta.url));

/**
 * The refusal of `files`, which went through {@link SELECTION_LOADER} and not
 * {@link AFTER_LOADER}: a configuration put together by hand, carrying one
 * without the other. Run, they would record that no test ran a line of them.
 */
export function unprobedFiles(root: string, files: Iterable<string>): Error {
  const named = [...files].map((file) => `\`${projectPath(root, file)}\``).sort();
  return new Error(
    `variance-authority: ${named.join(', ')} went through \`${basename(SELECTION_LOADER)}\` and never reached ` +
      `\`${basename(AFTER_LOADER)}\`, so no probe was placed in ${named.length === 1 ? 'it' : 'them'} and nothing was recorded. ` +
      "Add a rule with `enforce: 'post'` that runs `@variance-authority/sense/rstest-after-loader` on the same files, or build the configuration with `withTestSelection`.",
  );
}
