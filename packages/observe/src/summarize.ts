import { formatSource, resolveSource } from '@variance-authority/core';
import type { AttributedRegion, SourceIndex } from '@variance-authority/core';
import type { Observation } from './observe.js';

/**
 * The observation as the thing a reviewer or an agent reads — and the only
 * implementation of it.
 *
 * There were two. This one was exported, documented and called by nothing, while
 * `@variance-authority/playwright-test` grew its own for the message a failing
 * assertion prints — which is the same job, from the same value, phrased
 * differently. Two formatters over one value drift, and the day they do, two
 * people looking at the same observation disagree about what it found with no way
 * to tell which of them is reading the one that was fixed. So the assertion
 * message is this function, and the caveat below is the reason the *merged*
 * version is the surviving one rather than either original.
 *
 * The shape is the semantic report's, for its reasons: a cause per line rather
 * than a picture, and a file path on the end, because `Toggle` is an identifier
 * and `src/ds/components.tsx:107` is an edit.
 */
export function summarizeObservation(
  observation: Observation,
  options: { readonly source?: SourceIndex } = {},
): string {
  const head = `${observation.subject}: ${observation.verdict} — ${observation.because}`;
  if (observation.regions.length === 0) return head;

  // Ordered by area, and it says so. An `Observation` carries one snapshot, so
  // nothing here knows which component was *edited* and which was merely
  // reflowed — and area measures displacement, which on this project's own
  // corpus ranks the reflowed container above the edit by 6×. `rankRegions` is
  // the instrument that fixes it and it needs causes, which arrive a layer up in
  // the run report. Printing the ordering without the caveat would be this
  // function asserting a ranking it did not compute.
  const regions = [...observation.regions].sort((a, b) => b.region.pixels - a.region.pixels);

  return [
    head,
    `${regions.length} region(s), ordered by area — no causes were supplied, so this`,
    'ordering measures displacement rather than blame:',
    ...regions.map((region) => line(region, options.source)),
  ].join('\n');
}

/**
 * One region, named where a name exists and addressed where none does.
 *
 * A coordinate is printed only for a region nothing could attribute, and that is
 * the whole rule: a name is what the reader acts on, and an address is what is
 * left when there is no name to give them. Printing both every time trains the
 * eye past the half that matters.
 */
function line(region: AttributedRegion, source: SourceIndex | undefined): string {
  const nearest =
    region.nearest?.component === undefined ? '' : ` (nearest: ${region.nearest.component})`;
  const { x, y, width, height } = region.region;
  // `path` is not among the candidates, and that is deliberate. A tree with no
  // provenance — every page not written in React — left this printing the child
  // index of the containing node, so a failing Playwright assertion read
  // `1510px — 0`, three times, with the three rows distinguished only by their
  // pixel counts. `locate.ts` says why: an address tells a reviewer nothing. It
  // is at least an address a reader can find in the diff image when it is a rect,
  // and `0` is not even that.
  const what = region.unattributed
    ? `unattributed at ${x},${y}${nearest}`
    : (region.component ?? `at ${x},${y} (${width}×${height})`);

  const declared =
    source !== undefined && region.component !== undefined
      ? resolveSource(region.component, source)
      : null;

  // The element's own line wins. Resolving a name answers where the component is
  // declared, which is the same answer for every instance of it; this answers
  // which instance.
  const file =
    region.source !== undefined
      ? `${region.source.file}:${region.source.line}`
      : declared !== null
        ? formatSource(declared)
        : null;

  return [
    `  ${region.region.pixels}px — ${what}`,
    region.where !== undefined && region.where !== '' ? `      in ${region.where}` : null,
    file !== null ? `      ${file}` : null,
  ]
    .filter((entry): entry is string => entry !== null)
    .join('\n');
}
