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
import { captureAfter, type ComposedMap } from './captured-modules.js';
import { inlineMap } from './cut-map.js';
import { defaultInclude } from './instrumented-modules.js';
import type { JestTransformedSource } from './jest-transform.js';

/**
 * `done`, what the project's transformer wrote from `source`, with the probes
 * of `source`'s regions in it. A module `defaultInclude` and `unprobed` both
 * refuse is `done` as it came. A transformer that changed the text and returned
 * no map leaves nothing to place the regions through, so the answer is nothing,
 * and the caller hands that transformer the probed text instead.
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
  const inline = given === undefined ? inlineMap(done.code) : undefined;
  const code = inline?.code ?? done.code;
  const text = typeof given === 'string' ? given : inline?.map;
  const map = (text === undefined ? given : JSON.parse(text)) as (ComposedMap & Record<string, unknown>) | undefined;
  if (map === undefined && code !== source) return undefined;
  const captured = captureAfter(root, path, code, defaultInclude, mode, map && (() => map), {
    unprobed,
    carry: true,
    original: (at) => (at === path ? source : readFileSync(at, 'utf8')),
  });
  if (captured === undefined) return done;
  return {
    code: captured.code,
    map: map === undefined ? null : JSON.stringify(captured.carried === undefined ? map : { ...map, mappings: captured.carried }),
  };
}
