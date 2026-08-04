import { formatSource, resolveSource } from '@variance-authority/core';
import type { AttributedRegion, SourceIndex } from '@variance-authority/core';
import type { Observation } from '@variance-authority/observe';

/**
 * What a failing assertion prints, as a pure function of the observation.
 *
 * Separate from the matcher for the reason the matcher's own comment claims:
 * this is the part worth testing, and a matcher registered on Playwright's
 * `expect` can only be tested by running Playwright. The claim and the test file
 * next to this one are the same statement.
 *
 * The message is the product. `1530 pixels differ` is what the incumbent prints
 * and it is unassignable — the only available response is to open the image and
 * look, which is the expensive act this is meant to replace.
 */

function line(region: AttributedRegion, source: SourceIndex | undefined): string {
  const component = region.component ?? region.path ?? 'unattributed';
  const resolved = source === undefined ? null : resolveSource(component, source);

  return (
    `  ${region.region.pixels}px — ${component}` +
    (region.where !== undefined && region.where !== '' ? `\n      in ${region.where}` : '') +
    (resolved !== null ? `\n      ${formatSource(resolved)}` : '')
  );
}

export function describeObservation(
  observation: Observation,
  source?: SourceIndex,
): string {
  const head = `${observation.subject}: ${observation.verdict} — ${observation.because}`;
  if (observation.regions.length === 0) return head;

  // Ordered by area, and it says so. `observeAgainstBaseline` carries one
  // snapshot, so nothing here knows which component was *edited* and which was
  // merely reflowed — and area measures displacement, which on this project's
  // own corpus ranks the reflowed container above the edit by 6×. Printing the
  // ordering without the caveat would be the report asserting a ranking it did
  // not compute.
  const regions = [...observation.regions].sort((a, b) => b.region.pixels - a.region.pixels);

  return [
    head,
    `${regions.length} region(s), ordered by area — no causes were supplied, so this`,
    'ordering measures displacement rather than blame:',
    ...regions.map((region) => line(region, source)),
  ].join('\n');
}
