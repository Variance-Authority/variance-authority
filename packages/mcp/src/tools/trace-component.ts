import { stringArg, type Tool } from './tool.js';

/**
 * `variance_trace_component` — the only answer here that reads across subjects.
 *
 * Its own module because everything else in this package narrows to one subject
 * and then goes deeper. This goes the other way: it holds a component still and
 * sweeps the run past it, and what it returns is a size rather than a diagnosis.
 */

/**
 * A component, across the whole run.
 *
 * The question a design-system change actually raises. "Did `Button` change" is
 * answerable from one subject; "what did changing `Button` reach" is not, and it
 * is the one that decides whether a branch is safe.
 */
export const trace: Tool = {
  name: 'variance_trace_component',
  description:
    'Every subject a component appears in across the run, with pixels and whether it was ' +
    'the cause of the change or was displaced by it. Use to size the blast radius of a ' +
    'design-system or token edit.',
  inputSchema: {
    type: 'object',
    properties: { component: { type: 'string' } },
    required: ['component'],
    additionalProperties: false,
  },

  run(report, input) {
    const component = stringArg(input, 'component');

    const hits = report.observations.flatMap((observation) => {
      const regions = observation.regions.filter((region) => region.component === component);
      return regions.length === 0 ? [] : [{ observation, regions }];
    });

    if (hits.length === 0) return `\`${component}\` does not appear in any region in this run`;

    const causeIn = hits.filter(({ regions }) => regions.some((region) => region.cause));
    const file = hits.flatMap(({ regions }) => regions.map((r) => r.file)).find(Boolean);

    return [
      `\`${component}\` appears in ${hits.length} subject(s); ` +
        `it is the cause in ${causeIn.length} of them` +
        (file !== undefined ? ` — ${file}` : ''),
      '',
      ...hits.map(({ observation, regions }) => {
        const pixels = regions.reduce((sum, region) => sum + region.pixels, 0);
        const role = regions.some((region) => region.cause) ? 'cause' : 'collateral';
        return `  ${observation.subject}: ${pixels}px in ${regions.length} region(s) [${role}]`;
      }),
    ].join('\n');
  },
};
