import {
  AGE_WORDS,
  ageOf,
  byArrival,
  byBand,
  carriedLine,
  findingTotals,
  mixedAges,
} from '@variance-authority/report';
import type {
  FindingRecord,
  FlakinessRecord,
  RegionRecord,
  RunReport,
} from '@variance-authority/report';
import { describePresentation } from '../presentation.js';
import { subjectOf, unobserved } from './subject.js';
import type { Tool } from './tool.js';

/**
 * `variance_describe`, and the region format nothing else prints.
 *
 * `regionLine` stays with the tool because the region list is this answer's whole
 * substance, and everything around it is an ordering decision that belongs to
 * this tool rather than to regions in general: the leak warning above the list
 * because it changes what every line below means, the findings before it because
 * an `unchanged` subject can carry nothing else, and the truncation count after
 * it because a capped list that does not say so reads as a complete one.
 */

/**
 * One subject, in full: what changed, where it is, and which file to open.
 *
 * The tool an agent calls after the summary, and the one that has to be complete
 * — an agent that has to ask three more questions to locate an edit will guess
 * instead.
 */
export const describe: Tool = {
  name: 'variance_describe',
  description:
    'Everything known about one subject: the ranked regions, the component each belongs to, ' +
    'a landmark description of where it is on the page, the source file to edit, and each ' +
    "region's shape fingerprint — which is what `variance accept --shape` and an `ignore` " +
    'rule are keyed on when a difference is not a code problem. Causes are listed before ' +
    'collateral. A subject the run did not observe is answered with why, not refused.',
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
      `[${label(observation)}] ${observation.subject}`,
      observation.because,
      // Ahead of the leak note, because it disqualifies that one too. A clean
      // world re-collection was never taken on this subject — its answer would
      // have been a comparison between two readings that do not agree anyway —
      // so there is no order-dependence claim here to place second.
      ...(observation.unstable !== undefined && observation.unstable.absorbed === undefined
        ? [
            `NOT A COMPONENT CHANGE: ${observation.unstable.because}. The regions below are`,
            'the difference between one of those two readings and the baseline, so which',
            'ones appear here is decided by a race. Do not review them and do not accept',
            'this subject. Fix what moves between two readings of the same page' +
              (observation.unstable.components.length === 0
                ? ', starting from the subject itself — no snapshot was collected, so nothing'
                  + ' could name the component that moved.'
                : `, starting at ${unstableAt(observation.unstable.components)}` +
                  (observation.unstable.bands.length === 0
                    ? '.'
                    : ` (${observation.unstable.bands.join(', ')}).`)),
          ]
        : []),
      // What the record says, directly under the instruction it qualifies. An
      // agent handed "fix what moves between two readings" acts differently when
      // the answer is "this has fired in eleven of the last twelve sweeps" than
      // when it is "twice in March, and nine sweeps have been clean since" — the
      // second is a fix that already landed, and rewriting it is a day spent
      // re-solving somebody's solved problem.
      ...(observation.unstable !== undefined ? recurrence(report, observation.subject) : []),
      // The experiment, spelled out. An agent that has just been told to fix
      // what moves between two readings needs a way to find out whether it did,
      // and the alternative it reaches for otherwise is a full run — three
      // hundred subjects and a browser, to answer a question about one of them.
      ...(observation.unstable !== undefined && observation.unstable.absorbed === undefined
        ? [
            'VERIFY A FIX WITH:',
            `  variance run --subjects '${observation.subject}' --flakes`,
            'which reads this subject twice and nothing else, and exits 1 while the two',
            'readings still disagree — even when every verdict is green.',
          ]
        : []),
      // The same movement, inside the boundary the subject declared. Said rather
      // than suppressed: an agent that later sees this subject go green wants to
      // know a level was doing work, and the rule's name is what makes that
      // auditable. It carries no instruction, because there is nothing to do.
      ...(observation.unstable?.absorbed !== undefined
        ? [
            `read differently between two readings in ${(observation.unstable.bands ?? []).join(', ')}, ` +
              `and \`${observation.unstable.absorbed.rule}\` asserts on ` +
              `${observation.unstable.absorbed.level} — so none of it is asserted on here. ` +
              'Working as declared; the regions below are the comparison, not the movement.',
          ]
        : []),
      // Placed under the verdict, because it changes what every line below it
      // means. The regions are still correct — those pixels really did move, in
      // those components — but they are the shape of a leak rather than the shape
      // of an edit, and an agent that reads the region list first starts editing a
      // component whose source nobody changed.
      ...((observation.unstable === undefined || observation.unstable.absorbed !== undefined) &&
      observation.alone?.reproduced === false
        ? [
            `NOT A COMPONENT CHANGE: ${observation.alone?.because}. The regions below are real`,
            'but they are what the leak did, not what an edit did. Do not change these',
            'components. Find the subject that writes the state this one reads by bisecting',
            'run order — the run cannot name it, because module-level state is invisible to',
            'anything a rendered document can observe about itself.',
          ]
        : []),
      ...(observation.missingFonts !== undefined && observation.missingFonts.length > 0
        ? [
            `warning: the renderer lacked ${observation.missingFonts.join(', ')}; ` +
              'these images are of a substituted font and their metrics are not the product’s',
          ]
        : []),
    ];

    // What the record says about the components this subject's change was
    // attributed to. Placed after the verdict and before the regions, because it
    // changes how the region list should be read: a component that has caused an
    // approved change in eleven of the last forty runs is a component whose next
    // change is unremarkable, and one that has never moved before is the opposite.
    lines.push(...componentChurn(report, observation));

    // Findings before regions. A subject can be `unchanged` and still carry
    // them, in which case they are the only thing this tool has to say, and a
    // reader who stopped at "nothing changed" would never reach them.
    if (observation.findings !== undefined && observation.findings.length > 0) {
      lines.push('', findingTotals(observation.findings) + ':', ...findingLines(observation.findings));
    }

    if (observation.signals?.presentation !== undefined) {
      lines.push('', ...describePresentation(observation.signals.presentation));
    }

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
 * What the subject *is*, which is not always its verdict.
 *
 * Three words over one, and the order is the precedence: instability disqualifies
 * the clean-world answer, which in turn re-reads the verdict. All three subjects
 * are `changed` — the pixels did move — and all three need different work, so a
 * reader given the verdict alone acts on the wrong one two times out of three.
 */
function label(observation: {
  readonly verdict: string;
  readonly unstable?: { readonly absorbed?: unknown };
  readonly alone?: { readonly reproduced: boolean };
}): string {
  if (observation.unstable !== undefined && observation.unstable.absorbed === undefined) {
    return 'unstable';
  }
  if (observation.alone?.reproduced === false) return 'order-dependent';
  return observation.verdict;
}

/**
 * How often the components named here have changed before.
 *
 * Only the causes, and only the ones the record answered for. A component this
 * report has no entry for is not a component that has never changed — it is one
 * nobody asked about, either because no store answered or because the run capped
 * how many it asked. Silence is therefore silent rather than reassuring: nothing
 * is printed for it, and the run's own warnings carry the reason.
 */
function componentChurn(
  report: RunReport,
  observation: { readonly regions: readonly RegionRecord[] },
): readonly string[] {
  if (report.churn === undefined) return [];

  const named = [
    ...new Set(
      observation.regions
        .filter((region) => region.cause && region.component !== undefined)
        .map((region) => region.component as string),
    ),
  ];

  const lines = named.flatMap((component) => {
    const record = report.churn?.[component];
    return record === undefined ? [] : [`  ${record.because}`];
  });

  return lines.length === 0 ? [] : ['', 'HOW OFTEN THESE COMPONENTS CHANGE:', ...lines];
}

/**
 * How often this has happened before, or the fact that nobody was asked.
 *
 * The absent arm is not politeness. Two readings put a floor under flakiness and
 * never a ceiling, so "no record answered" and "this has never happened" are
 * different sentences with different next actions — and only one of them is
 * something this report can support.
 */
function recurrence(report: RunReport, subject: string): readonly string[] {
  const record = report.flakiness?.[subject];

  if (record === undefined) {
    return [
      'No history record answered for this subject, so nothing here says whether it has',
      'happened before. Absence of a record is not a first occurrence.',
    ];
  }

  const named = record.causes
    .map((cause: FlakinessRecord['causes'][number]) =>
      [cause.component, cause.band].filter((part) => part !== undefined).join(' '),
    )
    .filter((label: string) => label !== '')
    .slice(0, 3);

  return [
    `OVER THE RECORDED WINDOW: ${record.because}.` +
      (named.length === 0 ? '' : ` Seen in: ${named.join(', ')}.`),
    ...(record.sweepsSince > 0 && record.occurrences > 1
      ? [
          'It has been quiet for the last few sweeps, so check whether a fix already landed',
          'before writing another one.',
        ]
      : []),
  ];
}

/** The unstable components as `Name file:line`, which is what an editor opens. */
function unstableAt(
  components: readonly { readonly name: string; readonly file?: string }[],
): string {
  return components
    .map((component) =>
      component.file === undefined ? component.name : `${component.name} ${component.file}`,
    )
    .join(', ');
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
    // The digest, on the region it describes. An agent's two non-code responses
    // to a recurring difference are `variance accept --shape <it>` and an
    // `ignore` rule keyed on it, and neither is reachable without the value —
    // printing it in a different section would make an agent guess which line it
    // belonged to.
    region.fingerprint !== undefined ? `      shape ${region.fingerprint}` : null,
  ]
    .filter((line): line is string => line !== null)
    .join('\n');
}

/**
 * The defects under the band each was filed as, dated where the record says.
 *
 * The same two questions the review page and the HTML report answer above their
 * own lists, and the same fold answering them — an agent reading a flat list of
 * eleven rules has to know which of them the project blocks on and which of them
 * it inherited, and neither is derivable from the rule name.
 *
 * The band heads a group rather than prefixing a row because most renders carry
 * one band, and a word repeated down a column is a word a reader stops seeing.
 *
 * Above the bands is the split the review page and the HTML report draw: what
 * this change brought, then — under its own count — what it did not. There is no
 * folding to do in text, so the separation is an order and a line, and the order
 * is the part that matters. An agent handed twenty inherited defects first will
 * either fix twenty or fix none.
 */
function findingLines(findings: readonly FindingRecord[]): readonly string[] {
  const { arrived, rest, dated } = byArrival(findings);
  if (!dated) return bandLines(findings);

  const carried = carriedLine(findings);

  return [
    ...(arrived.length === 0 ? [] : bandLines(arrived)),
    ...(carried === undefined ? [] : [`  ${carried} — separate work`, ...bandLines(rest)]),
  ];
}

/** One list, banded, dated per row only where the rows disagree. */
function bandLines(findings: readonly FindingRecord[]): readonly string[] {
  const dated = mixedAges(findings);

  return byBand(findings).flatMap((group) => [
    `  ${group.title}`,
    ...group.findings.map(
      (finding) =>
        `    [${finding.rule}] ${finding.what}` +
        (dated ? ` — ${AGE_WORDS[ageOf(finding)]}` : '') +
        (finding.file === undefined ? '' : `\n      ${finding.file}`),
    ),
  ]);
}

