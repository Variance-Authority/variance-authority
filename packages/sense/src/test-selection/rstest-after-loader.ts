/**
 * The Rstest seam's probes on what the project's loaders wrote, as an Rspack
 * loader.
 *
 * A compiler that reads syntax — a CSS-in-JS extractor, a macro, a memoising
 * compiler — reads probes too when they go in first. Declared `enforce: 'post'`,
 * this loader runs after SWC and every loader the project configured, and the
 * probes go into what they wrote, where the map they handed on says each region
 * of the file on disk went: the regions, ordinals and id are the file's, cut
 * from the text on disk. Rspack composes the map this hands on with the ones
 * before it, so the map handed on is theirs, moved onto the probed text.
 *
 * The test files the run cuts were cut before SWC, by the
 * [`enforce: 'pre'` loader](./rstest-loader.ts), and their map carries the
 * cut. A module whose file names its own map was probed there too, and passes
 * here untouched, as do the seam's own setup shim and a build whose snapshot
 * names no run.
 */

import { readFileSync } from 'node:fs';
import type { ComposedMap } from './captured-modules.js';
import { captureAfter } from './captured-modules.js';
import { cleanId } from './instrumented-modules.js';
import type { SelectionLoaderOptions } from './rstest-loader.js';
import { runOf } from './selection-run.js';
import { namesItsMap } from './source-lines.js';

/** A map as a loader receives one: an object, its JSON, or none. */
type HandedMap = (ComposedMap & Record<string, unknown>) | string | null | undefined;

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
  if (run === undefined || run.shims.has(file) || namesItsMap(disk(file))) {
    this.callback(null, code, handed);
    return;
  }
  const map = (typeof handed === 'string' ? JSON.parse(handed) : (handed ?? undefined)) as
    | (ComposedMap & Record<string, unknown>)
    | undefined;
  let captured;
  try {
    captured = captureAfter(run.root, file, code, run.include, run.mode, map && (() => map), {
      unprobed: run.unprobed,
      carry: true,
    });
  } catch (error) {
    this.callback(error as Error);
    return;
  }
  if (captured === undefined) {
    this.callback(null, code, handed);
    return;
  }
  run.modules.set(captured.module.id, captured.module);
  this.callback(null, captured.code, map && captured.carried !== undefined ? { ...map, mappings: captured.carried } : undefined);
}

/** The file on disk, or nothing when it cannot be read. */
function disk(file: string): string {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return '';
  }
}

// Named here and exported as the default, because a loader is named by path:
// the rule spells the file, never the function.
export { probeAfter as default };
