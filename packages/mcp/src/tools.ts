import type { NotObserved, ObservationRecord, RegionRecord, RunReport } from './report.js';

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
 * Overview: what happened, what needs attention, and what was never looked at.
 *
 * Deliberately does not list unchanged subjects. A run over 300 subjects where
 * two changed should print two lines — a list as long as the suite is the "100
 * changes? merge" failure in its purest form, and the reader stops reading long
 * before the interesting line.
 *
 * The coverage section is the exception to that economy and is not negotiable.
 * A run that planned 300 subjects, failed on 50 and found the other 250
 * unchanged has an observation list in which every entry is clean; a summary
 * computed from observations alone therefore reports it as a clean run, and an
 * agent acts on that. So `nothing to review` is claimed only from a report that
 * accounted for every subject it planned — never from silence, and never over a
 * subject the run meant to see and could not. That is the same rule the CLI's
 * exit code applies, stated in the same words, because a human and an agent
 * reading one artifact must not be able to disagree about whether it was green.
 */
const summarize: Tool = {
  name: 'variance_summary',
  description:
    'What the last visual run found: counts by verdict, then one line per subject that ' +
    'needs attention, then which subjects were not observed at all. Unchanged subjects are ' +
    'counted, not listed. Start here.',
  inputSchema: NO_ARGS,

  run(report) {
    const counts = new Map<string, number>();
    for (const observation of report.observations) {
      counts.set(observation.verdict, (counts.get(observation.verdict) ?? 0) + 1);
    }

    const header = [
      `${report.observations.length} subject(s) observed, ${report.retention} run at ${report.at}`,
      `rendered by ${describeIdentity(report)}`,
      // The coverage state joins the verdict counts rather than only appearing in
      // the section below, because that section is as long as the hole is and the
      // hole is what a reader most needs in the first four lines. A run that lost
      // 50 subjects otherwise opens with "250 unchanged" and says so 50 lines later.
      [...counts.entries()]
        .map(([verdict, count]) => `${count} ${verdict}`)
        .concat(shortfall(report))
        .join(', '),
      ...(report.intent !== undefined ? [`intent: ${report.intent}`] : []),
    ];

    const notable = report.observations.filter((o) => o.verdict !== 'unchanged');

    return [
      ...header,
      ...(notable.length === 0
        ? []
        : [
            '',
            ...notable.map((observation) => {
              const cause = observation.regions.find((region) => region.cause);
              const lead = cause?.component !== undefined ? ` — ${cause.component}` : '';
              return `[${observation.verdict}] ${observation.subject}${lead}: ${observation.because}`;
            }),
          ]),
      '',
      ...coverage(report),
      ...(notable.length === 0 ? ['', settlement(report)] : []),
    ].join('\n');
  },
};

/**
 * The coverage section, in three states — and the third is why this is not
 * simply a list.
 *
 * `absent` means the report's writer never said what it skipped. That is not the
 * same sentence as "it skipped nothing" and must not be printed as one: a reader
 * shown a clean summary over a report that never counted its subjects has been
 * told the suite is green by something that never looked at the suite. Costs
 * three lines of output on every report a `variance run` did not write, which is
 * the price of not collapsing "unknown" into "fine".
 */
function coverage(report: RunReport): readonly string[] {
  const entries = report.notObserved;

  if (entries === undefined) {
    return [
      'coverage: unknown — this report does not state which subjects were not observed.',
      '  It was not written by `variance run`, so silence about a subject here cannot be',
      '  read as a pass.',
    ];
  }

  if (entries.length === 0) return ['coverage: every planned subject was observed.'];

  const failed = entries.filter((entry) => entry.kind === 'failed');
  const excluded = entries.filter((entry) => entry.kind === 'excluded');

  // Every entry is named, however many there are. A count alone leaves an agent
  // unable to act, and a capped list reads as complete coverage — the failure
  // `truncated` exists to prevent, applied to the list that matters most.
  return [
    `not observed: ${entries.length} subject(s) — ` +
      `${failed.length} the run could not see, ${excluded.length} excluded by configuration`,
    ...failed.map(coverageLine),
    ...excluded.map(coverageLine),
  ];
}

function coverageLine(entry: NotObserved): string {
  return `  [${entry.kind}] ${entry.subject}: ${entry.because}`;
}

/** The coverage state as one clause, for the counts line. Empty when there is none to state. */
function shortfall(report: RunReport): readonly string[] {
  if (report.notObserved === undefined) return ['coverage unknown'];
  return report.notObserved.length === 0
    ? []
    : [`${report.notObserved.length} not observed`];
}

/**
 * The closing sentence when no observation is notable — the one an agent stops
 * reading at, and therefore the one that must not overstate.
 *
 * Only the third branch may say "nothing to review". The first two are the cases
 * where the observations are all clean and the run still is not: an unaccounted
 * report, and a hole the run meant to fill. Both mirror `exitFor`'s `1`.
 */
function settlement(report: RunReport): string {
  const entries = report.notObserved;

  if (entries === undefined) {
    return (
      'no observed subject needs review, but this report never stated what it skipped — ' +
      'it cannot be read as a clean run'
    );
  }

  const failed = entries.filter((entry) => entry.kind === 'failed').length;
  if (failed > 0) {
    return (
      `no observed subject needs review, but ${failed} subject(s) the run meant to see were ` +
      'not observed — an absent observation is not an unchanged one'
    );
  }

  return 'nothing to review';
}

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
    'Causes are listed before collateral. A subject the run did not observe is answered ' +
    'with why, not refused.',
  inputSchema: {
    type: 'object',
    properties: { subject: { type: 'string', description: 'Subject id from variance_summary.' } },
    required: ['subject'],
    additionalProperties: false,
  },

  run(report, input) {
    const located = subjectOf(report, input);
    if (!located.observed) return unobserved(located.entry);
    const { observation } = located;

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
 *
 * A subject with no observation at all is the third such case and the worst one
 * to refuse. "Unknown subject" tells an agent the subject does not exist, so it
 * stops asking; the truth is that the subject exists and nothing is known about
 * it, which is the opposite conclusion.
 */
const explain: Tool = {
  name: 'variance_explain_verdict',
  description:
    'Why a subject was not compared. `incomparable` means a baseline exists but another ' +
    'machine rendered it; `new` means none exists; a subject in the coverage list was never ' +
    'observed at all. None is a code problem — call this before attempting a fix.',
  inputSchema: {
    type: 'object',
    properties: { subject: { type: 'string' } },
    required: ['subject'],
    additionalProperties: false,
  },

  run(report, input) {
    const located = subjectOf(report, input);

    if (!located.observed) {
      return [
        unobserved(located.entry),
        '',
        located.entry.kind === 'excluded'
          ? 'Nothing was compared, so nothing is known about this subject. There is no code ' +
            'change to make here; if it should be watched, change the exclusion.'
          : 'Nothing was compared, so nothing is known about this subject — an absent ' +
            'observation is not an unchanged one. Fix whatever stopped the run from seeing ' +
            'it before treating any part of this run as a pass for this subject.',
      ].join('\n');
    }

    const { observation } = located;

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

/**
 * A subject named in the run, and which of the two lists it came from.
 *
 * A union rather than `ObservationRecord | undefined` so that "the run did not
 * observe this" cannot be handled by accident. Every caller has to decide what to
 * say about a subject with no observation, and the answer is never a verdict.
 */
type Located =
  | { readonly observed: true; readonly observation: ObservationRecord }
  | { readonly observed: false; readonly entry: NotObserved };

function subjectOf(report: RunReport, input: Readonly<Record<string, unknown>>): Located {
  const subject = stringArg(input, 'subject');

  const observation = report.observations.find((entry) => entry.subject === subject);
  if (observation !== undefined) return { observed: true, observation };

  // The coverage list is searched too, and this is the point of it. A subject the
  // run planned and could not see is a subject an agent will ask about; refusing
  // the name tells it the subject does not exist, which is both false and the
  // conclusion that ends the investigation.
  const skipped = report.notObserved?.find((entry) => entry.subject === subject);
  if (skipped !== undefined) return { observed: false, entry: skipped };

  // Listing the alternatives rather than only refusing: an agent that gets
  // "unknown subject" retries with another guess, and an agent that gets the
  // list picks the right one.
  throw new Error(
    `unknown subject "${subject}"; this run has: ` +
      [
        ...report.observations.map((entry) => entry.subject),
        ...(report.notObserved ?? []).map((entry) => entry.subject),
      ].join(', '),
  );
}

/**
 * What to say about a subject with no observation — the CLI's wording, verbatim.
 *
 * Duplicated text rather than a shared helper only because the packages point the
 * other way round, and the duplication is deliberate where drift would be worst:
 * a human running `variance report --subject x` and an agent calling
 * `variance_describe` on the same subject must be told the same thing, or the two
 * of them will argue about a run neither can re-observe.
 */
function unobserved(entry: NotObserved): string {
  return [
    `[not observed] ${entry.subject}`,
    entry.because,
    entry.kind === 'excluded'
      ? 'This was excluded by configuration, not by a failure.'
      : 'The run meant to observe this and could not. It is not a pass.',
  ].join('\n');
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
