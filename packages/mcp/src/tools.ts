import type { ObservationRecord, RegionRecord, RunReport } from './report.js';

/**
 * The tools, as pure functions over a run report.
 *
 * Separated from the transport deliberately. A tool implementation tangled into
 * a JSON-RPC handler can only be exercised by speaking JSON-RPC at it, and the
 * interesting question — *does this answer help an agent fix the thing?* — then
 * becomes the hardest thing in the package to ask.
 *
 * Every answer is text, and the shape of that text is the product. An agent does
 * not benefit from a JSON blob it has to interpret; it benefits from the same
 * sentence a person would want, with a file path on the end. So these read like
 * the report does: cause first, collateral counted, and a path an editor opens.
 */

export interface Tool {
  readonly name: string;
  readonly description: string;
  readonly inputSchema: Readonly<Record<string, unknown>>;
  run(report: RunReport, input: Readonly<Record<string, unknown>>): string;
}

const NO_ARGS = { type: 'object', properties: {}, additionalProperties: false } as const;

/**
 * Overview: what happened, and what needs attention.
 *
 * Deliberately does not list unchanged subjects. A run over 300 subjects where
 * two changed should print two lines — a list as long as the suite is the "100
 * changes? merge" failure in its purest form, and the reader stops reading long
 * before the interesting line.
 */
const summarize: Tool = {
  name: 'variance_summary',
  description:
    'What the last visual run found: counts by verdict, then one line per subject that ' +
    'needs attention. Unchanged subjects are counted, not listed. Start here.',
  inputSchema: NO_ARGS,

  run(report) {
    const counts = new Map<string, number>();
    for (const observation of report.observations) {
      counts.set(observation.verdict, (counts.get(observation.verdict) ?? 0) + 1);
    }

    const header = [
      `${report.observations.length} subject(s), ${report.retention} run at ${report.at}`,
      `rendered by ${describeIdentity(report)}`,
      [...counts.entries()].map(([verdict, count]) => `${count} ${verdict}`).join(', '),
      ...(report.intent !== undefined ? [`intent: ${report.intent}`] : []),
    ];

    const notable = report.observations.filter((o) => o.verdict !== 'unchanged');
    if (notable.length === 0) return [...header, 'nothing to review'].join('\n');

    return [
      ...header,
      '',
      ...notable.map((observation) => {
        const cause = observation.regions.find((region) => region.cause);
        const lead = cause?.component !== undefined ? ` — ${cause.component}` : '';
        return `[${observation.verdict}] ${observation.subject}${lead}: ${observation.because}`;
      }),
    ].join('\n');
  },
};

/**
 * One subject, in full: what changed, where it is, and which file to open.
 *
 * The tool an agent calls after the summary, and the one that has to be complete
 * — an agent that has to ask three more questions to locate an edit will guess
 * instead.
 */
const describe: Tool = {
  name: 'variance_describe',
  description:
    'Everything known about one subject: the ranked regions, the component each belongs to, ' +
    'a landmark description of where it is on the page, and the source file to edit. ' +
    'Causes are listed before collateral.',
  inputSchema: {
    type: 'object',
    properties: { subject: { type: 'string', description: 'Subject id from variance_summary.' } },
    required: ['subject'],
    additionalProperties: false,
  },

  run(report, input) {
    const observation = subjectOf(report, input);

    const lines = [
      `[${observation.verdict}] ${observation.subject}`,
      observation.because,
      ...(observation.missingFonts !== undefined && observation.missingFonts.length > 0
        ? [
            `warning: the renderer lacked ${observation.missingFonts.join(', ')}; ` +
              'these images are of a substituted font and their metrics are not the product’s',
          ]
        : []),
    ];

    if (observation.regions.length === 0) return lines.join('\n');

    lines.push('', ...observation.regions.map(regionLine));

    if (observation.truncated !== undefined && observation.truncated.regions > 0) {
      // Never a silent cap: a truncated list that does not say so reads as
      // complete coverage, and the reader has no way to tell the difference.
      lines.push(
        `+${observation.truncated.regions} smaller region(s) not listed ` +
          `(${observation.truncated.pixels}px)`,
      );
    }

    if (observation.images !== undefined) {
      lines.push(
        '',
        'images: ' +
          Object.entries(observation.images)
            .map(([kind, path]) => `${kind}=${path}`)
            .join(' '),
      );
    }

    return lines.join('\n');
  },
};

/**
 * A component, across the whole run.
 *
 * The question a design-system change actually raises. "Did `Button` change" is
 * answerable from one subject; "what did changing `Button` reach" is not, and it
 * is the one that decides whether a branch is safe.
 */
const trace: Tool = {
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

/**
 * Why a subject has no comparison.
 *
 * `incomparable` and `new` are the two verdicts an agent will otherwise treat as
 * failures and try to fix in code, which is exactly wrong: neither is about the
 * code. This makes the reason legible enough to act on — or to decide not to.
 */
const explain: Tool = {
  name: 'variance_explain_verdict',
  description:
    'Why a subject was not compared. `incomparable` means a baseline exists but another ' +
    'machine rendered it; `new` means none exists. Neither is a code problem — call this ' +
    'before attempting a fix.',
  inputSchema: {
    type: 'object',
    properties: { subject: { type: 'string' } },
    required: ['subject'],
    additionalProperties: false,
  },

  run(report, input) {
    const observation = subjectOf(report, input);

    switch (observation.verdict) {
      case 'incomparable':
        return [
          observation.because,
          '',
          'This is not a code change and cannot be fixed in code. Either run on the machine ' +
            'that wrote the baseline, re-record the baseline on this one, or use an ephemeral ' +
            'comparison, which renders both sides here and needs no stored image at all.',
        ].join('\n');
      case 'new':
        return [
          observation.because,
          '',
          'Nothing has regressed; there is no baseline to regress from. Record one, ' +
            'or compare ephemerally against the previous revision.',
        ].join('\n');
      case 'unchanged':
        return `${observation.subject} was compared and did not change: ${observation.because}`;
      case 'changed':
        return `${observation.subject} was compared and changed. Call variance_describe for the regions.`;
    }
  },
};

export const TOOLS: readonly Tool[] = [summarize, describe, trace, explain];

export function toolByName(name: string): Tool | undefined {
  return TOOLS.find((tool) => tool.name === name);
}

function regionLine(region: RegionRecord): string {
  const head = region.unattributed === true
    ? `unattributed — a region no box contained, which usually means the scale or origin was wrong`
    : (region.component ?? region.path ?? 'unknown');

  return [
    `  ${region.cause ? 'cause     ' : 'collateral'} ${region.pixels}px ` +
      `at ${region.x},${region.y} ${region.width}×${region.height} — ${head}`,
    region.where !== undefined ? `      in ${region.where}` : null,
    region.file !== undefined ? `      ${region.file}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

function subjectOf(report: RunReport, input: Readonly<Record<string, unknown>>): ObservationRecord {
  const subject = stringArg(input, 'subject');
  const found = report.observations.find((observation) => observation.subject === subject);

  if (found === undefined) {
    // Listing the alternatives rather than only refusing: an agent that gets
    // "unknown subject" retries with another guess, and an agent that gets the
    // list picks the right one.
    throw new Error(
      `unknown subject "${subject}"; this run has: ` +
        report.observations.map((observation) => observation.subject).join(', '),
    );
  }
  return found;
}

function stringArg(input: Readonly<Record<string, unknown>>, name: string): string {
  const value = input[name];
  if (typeof value !== 'string' || value === '') {
    throw new Error(`\`${name}\` is required and must be a non-empty string`);
  }
  return value;
}

function describeIdentity(report: RunReport): string {
  const { renderer, engine, platform, deviceScaleFactor } = report.identity;
  return `${renderer} (${engine}, ${platform}, ${deviceScaleFactor}x)`;
}
