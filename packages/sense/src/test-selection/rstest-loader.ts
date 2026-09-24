/**
 * The recording half of the Rstest seam, as an Rspack loader.
 *
 * Rstest builds the suite with Rspack and runs what it built, so the place a
 * module can be instrumented is a loader rather than a plugin hook. Declared
 * `enforce: 'post'`, it receives what SWC made of a `.ts` file plus the map
 * that says where each line came from — the same situation a Vite plugin at
 * `enforce: 'post'` is in, and {@link recordedFrame} already answers it.
 *
 * A loader is loaded by path and given options, never handed the object the
 * configuration built, so the run it belongs to cannot be closed over. It is
 * found instead by the one string that names a run: the snapshot the run will
 * write. {@link runOf} answers with the run registered under it, and the
 * registry is on `globalThis` because Rstest builds and reports in one
 * process — the loader and the reporter are two halves of it.
 *
 * A build whose snapshot names no run is a loader that got as far as a
 * configuration that did not: it hands the module back untouched, and the
 * reporter's empty-record note is what the user reads.
 */

import { readFileSync } from 'node:fs';
import { instrument } from '../instrument/index.js';
import { cleanId, projectPath } from './instrumented-modules.js';
import { coverageBlock } from './coverage-rows.js';
import { recordedFrame, type TransformSourceMap } from './source-lines.js';
import { runOf } from './selection-run.js';

/** What the loader asks of the options its rule carries. */
export interface SelectionLoaderOptions {
  /** The snapshot of the run this build is recording for. */
  readonly coverageFile: string;
}

/** The subset of Rspack's loader surface this uses, so nothing here needs Rspack. */
export interface SelectionLoaderContext {
  /** The file on disk, without a bundler's query suffix. */
  readonly resourcePath: string;
  readonly getOptions: () => SelectionLoaderOptions;
  readonly callback: (
    error: null,
    code: string,
    map?: TransformSourceMap | undefined,
  ) => void;
}

/**
 * Place probes on one module Rspack is about to bundle, and record what they
 * mean.
 *
 * A module this run has no business in — the seam's own setup shim, anything
 * the `include` predicate refuses, a build whose snapshot names no run — is
 * handed back exactly as it arrived, map and all.
 */
function instrumentModule(
  this: SelectionLoaderContext,
  code: string,
  map?: TransformSourceMap,
): void {
  const file = cleanId(this.resourcePath);
  const run = runOf(this.getOptions().coverageFile);
  // This seam's own setup module installs the probe log; instrumented,
  // its own header would ask for the log before the module has installed
  // it. It is a file under the project root like any other, so it is excluded
  // by path rather than by the shape of its name.
  if (run === undefined || run.shims.has(file) || !run.include(file)) {
    this.callback(null, code, map);
    return;
  }

  // The digest is of the text on disk, which is what the block lines are
  // coordinates in once SWC's map is read back through — and of `code`, which
  // is what SWC made of it, when there is no map and the lines stay where they
  // were left.
  const { extentOf, sourceDigest, file: wrote } = recordedFrame(code, map, file, (at) =>
    readFileSync(at, 'utf8'),
  );

  // Under its id, the same one every other seam instruments under, so a journal
  // reads the same whoever produced it.
  const name = projectPath(run.root, wrote);
  const moduleId = run.names.idOf(name) ?? name;
  const done = instrument(code, name, moduleId, { mode: run.mode });
  if (done === undefined) {
    run.modules.set(moduleId, {
      file: name,
      id: moduleId,
      sourceDigest,
      instrumented: false,
      blocks: [],
    });
    this.callback(null, code, map);
    return;
  }

  run.modules.set(moduleId, {
    file: name,
    id: moduleId,
    sourceDigest,
    instrumented: true,
    blocks: done.blocks.map((block) => coverageBlock(code, block, extentOf)),
  });
  // Without the map it arrived with: the probes moved every line below the
  // first of them, and a map that says otherwise is worse than none.
  this.callback(null, done.code);
}

// Named here and exported as the default, because a loader is named by path:
// the rule spells the file, never the function.
export { instrumentModule as default };
