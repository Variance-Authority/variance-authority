/**
 * Probes placed by a bundler loader that runs after the project's own: the
 * path every Rspack and webpack seam shares.
 *
 * A loader declared `enforce: 'post'` runs after SWC, Babel and every loader
 * the project configured, so a compiler that reads syntax never reads a probe.
 * Rspack and webpack compose no loader maps: each loader hands the next the map
 * from its own output back to the file, so the map a loader at the end is
 * handed leads back to the file, and the one it hands on is that map moved onto
 * the probed text (`carry`). A file whose loaders handed on no map cannot be
 * placed, and is refused with the seam's `remedy`.
 */

import type { InstrumentMode } from '../instrument/index.js';
import { captureAfter, heldOriginal, type CapturedAfter, type ComposedMap } from './captured-modules.js';

/** A map as a loader receives one: an object, its JSON, or none. */
export type HandedMap = (ComposedMap & Record<string, unknown>) | string | null | undefined;

/** What decides where one seam's loader places a module's probes. */
export interface LoaderPlacement {
  /** The directory every recorded name is relative to: the checkout. */
  readonly root: string;
  /** Which modules are product source. */
  readonly include: (file: string) => boolean;
  /** Which modules are marked as loaded rather than probed; absent marks none. */
  readonly unprobed?: ((file: string) => boolean) | undefined;
  readonly mode: InstrumentMode | undefined;
  /** The file's text, where the loader already read it, so the placement reads it no second time. */
  readonly disk?: string | undefined;
  /** How this seam's project has its loaders hand a map on, for the refusal of a module that arrived with none. */
  readonly remedy: string;
}

/** One module a loader probed: what {@link captureAfter} placed, and the map to hand on with it. */
export interface LoaderProbed {
  readonly captured: CapturedAfter;
  /** The handed map moved onto the probed text, or the handed map where nothing moved; absent where none was handed. */
  readonly map: (ComposedMap & Record<string, unknown>) | undefined;
}

/**
 * Place the probes of `file`'s regions in `code`, the text the loaders before
 * this one wrote from it, through `handed`, the map they handed on.
 * `undefined` where the module is not one to probe; throws where its map
 * cannot be believed, as {@link captureAfter} refuses one.
 */
export function probeHanded(file: string, code: string, handed: HandedMap, placement: LoaderPlacement): LoaderProbed | undefined {
  const map = handedMap(handed);
  const captured = captureAfter(placement.root, file, code, placement.include, placement.mode, map && (() => map), {
    unprobed: placement.unprobed,
    carry: true,
    remedy: placement.remedy,
    original: heldOriginal(file, placement.disk),
  });
  if (captured === undefined) return undefined;
  return { captured, map: map && (captured.carried === undefined ? map : { ...map, mappings: captured.carried }) };
}

/**
 * `handed` as an object: a loader may hand its map on as JSON text, as
 * `swc-loader` does without `parseMap`.
 */
export function handedMap(handed: HandedMap): (ComposedMap & Record<string, unknown>) | undefined {
  return (typeof handed === 'string' ? JSON.parse(handed) : (handed ?? undefined)) as (ComposedMap & Record<string, unknown>) | undefined;
}
