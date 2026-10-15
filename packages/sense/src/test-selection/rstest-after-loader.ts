/**
 * The Rstest seam's probes on what the project's loaders wrote, as an Rspack
 * loader.
 *
 * A compiler that reads syntax, such as a CSS-in-JS extractor or a memoising
 * compiler, reads probes too when they go in first. Declared `enforce: 'post'`,
 * this loader runs after SWC and every loader the project configured, and the
 * probes go into what they wrote, where the map they handed on says each region
 * of the file on disk went: the regions, ordinals and id are the file's, cut
 * from the text on disk. Rspack composes no loader maps: each loader hands
 * the next the map from its own output back to the file, so the map this is
 * handed leads back to the file, and the one it hands on is that map moved
 * onto the probed text (`carry`).
 *
 * The test files the run cuts were cut before SWC, by the
 * [`enforce: 'pre'` loader](./rstest-loader.ts), and their map carries the
 * cut. A module whose file names its own map was probed there too, as is
 * every module of a run that places its probes `before-transforms`, and
 * passes here untouched, as do the seam's own setup shim and a build whose snapshot
 * names no run.
 */

import { readFileSync } from 'node:fs';
import { cleanId, fileOrNone } from './instrumented-modules.js';
import { probeHanded, type HandedMap } from './loader-probes.js';
import type { SelectionLoaderOptions } from './rstest-loader.js';
import { runOf } from './selection-run.js';
import { namesItsMap } from './source-lines.js';

/** The subset of Rspack's loader surface this uses, so nothing here needs Rspack. */
export interface AfterLoaderContext {
  /** The file on disk, without a bundler's query suffix. */
  readonly resourcePath: string;
  readonly getOptions: () => SelectionLoaderOptions;
  readonly callback: (error: Error | null, code?: string, map?: HandedMap) => void;
}

/** Place the probes of one module's regions in what the loaders before this wrote from it. */
function probeAfter(this: AfterLoaderContext, code: string, handed?: HandedMap): void {
  const file = cleanId(this.resourcePath);
  const run = runOf(this.getOptions().coverageFile);
  run?.awaiting.delete(file);
  // With `before-transforms`, the first loader placed them.
  if (run === undefined || run.shims.has(file) || run.placement === 'before-transforms') {
    this.callback(null, code, handed);
    return;
  }
  // A file `include` and `unprobed` both pass over is not read: under its own
  // name it is taken by neither, and a file that names its own map, which
  // could be taken under its source's name, was probed by the first loader.
  if (!run.include(file) && run.unprobed?.(file) !== true) {
    this.callback(null, code, handed);
    return;
  }
  let probed;
  try {
    // Read once: the placement is handed the text rather than reading the file again.
    const text = fileOrNone(file, (path) => readFileSync(path, 'utf8'));
    // A file that names its own map was probed by the first loader.
    probed = text !== undefined && namesItsMap(text)
      ? undefined
      : probeHanded(file, code, handed, { root: run.root, include: run.include, unprobed: run.unprobed, mode: run.mode, disk: text, remedy: REMEDY });
  } catch (error) {
    this.callback(error as Error);
    return;
  }
  if (probed === undefined) {
    this.callback(null, code, handed);
    return;
  }
  run.modules.set(probed.captured.module.id, probed.captured.module);
  this.callback(null, probed.captured.code, probed.map);
}

/**
 * Rstest asks Rspack for source maps unless the project turned `devtool` off;
 * a loader that rewrites the file and hands on no map breaks the chain too.
 */
const REMEDY = 'Leave Rspack\'s `devtool` writing source maps, as Rstest sets it, and have every loader ahead of the probes hand its map on';

// Named here and exported as the default, because a loader is named by path:
// the rule spells the file, never the function.
export { probeAfter as default };
