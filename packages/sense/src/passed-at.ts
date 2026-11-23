/**
 * Whether one recorded test ran a line, read off the regions of the module that
 * holds it: what `ask grep --test` marks each matching line by.
 */

// compass: variance-authority.reach.relations

import type { NativeRanModule, NativeRanRegion } from './native-journeys.js';
import { blocksChargedAt } from './test-selection/blocks-around.js';

/**
 * Where a test stands on one line: `undefined` when it ran the line; the
 * outermost `region` holding it that the test did not enter, with whether the
 * rest of the line ran; or, `unowned`, a region it did not enter on the lines
 * of a function it did, in a record that names no owners and so cannot say
 * whether the region is that function's.
 */
export type PassedAt =
  | { readonly region: NativeRanRegion; readonly partly: boolean }
  | { readonly unowned: NativeRanRegion; readonly beside: NativeRanRegion }
  | undefined;

/**
 * Where the test of `module` stands on `line`. It ran the line when an
 * innermost region holding it was entered, or none holds it; it passed it by
 * otherwise, in the outermost region holding it that it did not enter.
 */
export function passedAt(module: NativeRanModule, line: number): PassedAt {
  const holding = module.regions.filter((region) => region.kind !== 'module' && region.source && region.line <= line && line <= region.end);
  const span = (region: NativeRanRegion): number => region.end - region.line;
  // Lines cannot nest two regions of one span: a function holds a branch of its
  // own on it, its one-line guard; two functions or two branches sit side by side.
  const holds = (outer: NativeRanRegion) => (inner: NativeRanRegion): boolean =>
    outer.line <= inner.line && inner.end <= outer.end &&
    (span(inner) < span(outer) || (outer.kind === 'function' && inner.kind !== 'function' && inner.function === outer.function));
  const innermost = holding.filter((region) => !holding.some(holds(region)));
  if (innermost.length === 0) return undefined;
  const ran = innermost.filter((region) => region.entered);
  const [beside] = ran;
  if (beside !== undefined) {
    if (module.ownersNamed) return undefined;
    // Without owners a region of a function's own lines is in no function, so
    // whether it is that function's guard or its neighbour is not known.
    const unowned = innermost.find((inner) => inner.kind !== 'function' && !inner.entered &&
      ran.every((outer) => outer.kind === 'function' && outer.line === inner.line && outer.end === inner.end));
    return unowned === undefined ? undefined : { unowned, beside };
  }
  // `covering --line` charges a line that opens a region to the enclosing one
  // too: safe for choosing tests, wrong here, so it only says the rest ran.
  const charged = blocksChargedAt(
    module.regions.map((region) => ({ region, kind: region.kind, startLine: region.line, endLine: region.end, source: region.source })),
    line,
  );
  const region = holding
    .filter((region) => !region.entered)
    .reduce((best, region) => (span(region) > span(best) ? region : best));
  return { region, partly: charged.some(({ region }) => region.entered) };
}
