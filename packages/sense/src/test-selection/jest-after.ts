/**
 * The Jest seam's probes on what the project's transformer wrote.
 *
 * A compiler that reads syntax, such as a CSS-in-JS extractor or a memoising
 * compiler, reads probes too when they go in first. So the project's
 * transformer runs on the file as Jest read it, and the probes go into what it
 * wrote, where the map it returned says each region of the file went: the
 * regions, ordinals and id are the file's, cut from that text. Jest composes no
 * maps, so the transformer's map is answered moved onto the probed text, its
 * sources and names as they were, and a stack frame or an inline snapshot
 * names the line and column the transformer's map named.
 */

import { readFileSync } from 'node:fs';
import type { InstrumentMode } from '../instrument/index.js';
import { captureAfter, type ComposedMap, MapRefusal } from './captured-modules.js';
import { inlineMap } from './cut-map.js';
import { defaultInclude } from './instrumented-modules.js';
import type { JestTransformedSource } from './jest-transform.js';

/**
 * `done`, what the project's transformer wrote from `source`, with the probes
 * of `source`'s regions in it. A module `defaultInclude` and `unprobed` both
 * refuse is `done` as it came. A transformer that changed the text and returned
 * no map, a map that leads back to no source that is the file, as `@swc/jest`
 * writes one without `inputSourceMap`, one carrying a text for the file that is
 * not the file, or one with no mappings for a file with more than module code,
 * leaves nothing to place the regions through, so the answer is nothing, and
 * the caller hands that transformer the probed text instead. A map left inline as well as returned is dropped from
 * the text: the one returned is moved onto the probed text, and an inline one
 * would name the positions before the probes went in.
 */
export function probedAfter(
  root: string,
  path: string,
  source: string,
  done: JestTransformedSource,
  mode: InstrumentMode,
  unprobed: ((file: string) => boolean) | undefined,
): JestTransformedSource | undefined {
  const given = done.map == null || done.map === '' ? undefined : done.map;
  const inline = inlineMap(done.code);
  const code = inline?.code ?? done.code;
  const text = typeof given === 'string' ? given : given === undefined ? inline?.map : undefined;
  const map = (text === undefined ? given : JSON.parse(text)) as (ComposedMap & Record<string, unknown>) | undefined;
  let captured: ReturnType<typeof captureAfter>;
  try {
    captured = captureAfter(root, path, code, defaultInclude, mode, map && (() => map), {
      unprobed,
      carry: true,
      original: (at) => (at === path ? source : readFileSync(at, 'utf8')),
    });
  } catch (error) {
    if (error instanceof MapRefusal) return undefined;
    throw error;
  }
  if (captured === undefined) return done;
  return {
    code: captured.code,
    map: map === undefined ? null : JSON.stringify(captured.carried === undefined ? map : { ...map, mappings: captured.carried }),
  };
}
