/**
 * The recording half of the Rstest seam, as an Rspack loader.
 *
 * Rstest builds the suite with Rspack and runs what it built, so the place a
 * module can be instrumented is a loader rather than a plugin hook. Declared
 * `enforce: 'pre'`, it receives the file as it is on disk, before SWC — the
 * same text the Vite and Jest seams instrument, cut by {@link captureModule}.
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

import { cadence } from '../instrument/cadence.js';
import { captureModule } from './captured-modules.js';
import { cleanId } from './instrumented-modules.js';
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
  readonly callback: (error: null, code: string) => void;
}

/**
 * Place probes on one module Rspack is about to bundle, and record what they
 * mean.
 *
 * A test file is cut instead, unless the run turns cuts off. A module this
 * run has no business in — the seam's own setup shim, anything
 * the `include` predicate refuses, a build whose snapshot names no run — is
 * handed back exactly as it arrived.
 */
function instrumentModule(this: SelectionLoaderContext, code: string): void {
  const file = cleanId(this.resourcePath);
  const run = runOf(this.getOptions().coverageFile);
  // This seam's own setup module installs the probe log; instrumented,
  // its own header would ask for the log before the module has installed
  // it. It is a file under the project root like any other, so it is excluded
  // by path rather than by the shape of its name.
  if (run === undefined || run.shims.has(file)) {
    this.callback(null, code);
    return;
  }
  // A test file is cut rather than probed: nothing enters it, and what it
  // carries is which of its lines was running.
  if (run.cases && run.cadence?.(file) === true) {
    this.callback(null, cadence(code, file) ?? code);
    return;
  }
  const captured = captureModule(run.root, file, code, run.include, run.mode);
  if (captured !== undefined) run.modules.set(captured.module.id, captured.module);
  // With no map: every probe sits on the line it reports, so SWC's map from
  // this text is a map from the file on disk.
  this.callback(null, captured?.code ?? code);
}

// Named here and exported as the default, because a loader is named by path:
// the rule spells the file, never the function.
export { instrumentModule as default };
