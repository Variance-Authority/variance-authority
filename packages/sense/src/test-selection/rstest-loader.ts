/**
 * The recording half of the Rstest seam, as an Rspack loader.
 *
 * Rstest builds the suite with Rspack and runs what it built, so the place a
 * module can be instrumented is a loader rather than a plugin hook. This one is
 * declared `enforce: 'pre'`, so it receives the file as it is on disk, before
 * SWC, and it cuts the test files the run cuts, on that text, so a case says
 * which of their lines was running. A module gets its probes from the
 * [`enforce: 'post'` loader](./rstest-after-loader.ts), after the project's
 * own loaders, so a compiler that reads syntax never reads them, unless its
 * file names its own map, a build's output: a loader that reads that map
 * answers in the build's sources, never the file, so its probes go in here, by
 * {@link placeModule}.
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

import { cadence, type CutSourceMap } from '../instrument/cadence.js';
import { placeModule } from './captured-modules.js';
import { cleanId } from './instrumented-modules.js';
import { AFTER_LOADER, unprobedFiles } from './rstest-loaders.js';
import { namesItsMap } from './source-lines.js';
import { runOf, type SelectionRun } from './selection-run.js';

/** What the loader asks of the options its rule carries. */
export interface SelectionLoaderOptions {
  /** The snapshot of the run this build is recording for. */
  readonly coverageFile: string;
}

/** The subset of Rspack's loader surface this uses, so nothing here needs Rspack. */
export interface SelectionLoaderContext {
  /** The file on disk, without a bundler's query suffix. */
  readonly resourcePath: string;
  /** Every loader that runs on this file, by absolute path, where the bundler says. */
  readonly loaders?: readonly { readonly path: string }[];
  readonly getOptions: () => SelectionLoaderOptions;
  readonly callback: (error: Error | null, code?: string, map?: CutSourceMap) => void;
}

/**
 * Cut one test file Rspack is about to bundle, and probe one whose file names
 * its own map, or every module the run probes `before-transforms`.
 *
 * Any other module — one the run does not cut, the seam's own setup shim, a
 * build whose snapshot names no run — is handed back exactly as it arrived.
 */
function instrumentModule(this: SelectionLoaderContext, code: string): void {
  const file = cleanId(this.resourcePath);
  const run = runOf(this.getOptions().coverageFile);
  // This seam's own setup module is a file under the project root like any
  // other, so it is excluded by path rather than by the shape of its name.
  // So does every module, with `before-transforms`: no loader ahead of this one has read it.
  const first = run !== undefined && (run.placement === 'before-transforms' || namesItsMap(code));
  if (run === undefined || run.shims.has(file)) {
    this.callback(null, code);
    return;
  }
  // Every module is the probes loader's to reach, after the project's own: a
  // configuration that carries this loader without it fails here, where Rspack
  // names the loaders a file runs through, and otherwise at the run's end.
  if (this.loaders !== undefined && !this.loaders.some((loader) => loader.path === AFTER_LOADER)) {
    this.callback(unprobedFiles(run.root, [file]));
    return;
  }
  run.awaiting.add(file);
  if (!first && !cutting(run, file)) {
    this.callback(null, code);
    return;
  }
  const captured = first ? placeModule(run.root, file, code, run.include, run.unprobed, run.mode) : undefined;
  if (captured !== undefined) run.modules.set(captured.module.id, captured.module);
  const probed = captured?.code ?? code;
  // The cut keeps every line where it was, and its map moves the columns
  // back, so an inline snapshot is written into the call the test wrote.
  const cut = cutting(run, file) ? cadence(probed, file) : undefined;
  if (cut === undefined) this.callback(null, probed);
  else this.callback(null, cut.code, cut.map);
}

/** Whether the run cuts `file`: a test file, while cuts are on. */
function cutting(run: SelectionRun, file: string): boolean {
  return run.cases && run.cadence?.(file) === true;
}

// Named here and exported as the default, because a loader is named by path:
// the rule spells the file, never the function.
export { instrumentModule as default };
