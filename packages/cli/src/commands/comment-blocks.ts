import type { CliRunReport } from './run.js';
import type { CommentLimits, CommentOptions } from './comment.js';
import type { CauseEntry, Collateral, Docket } from './comment-docket.js';
import { code, count } from './comment-text.js';

/**
 * The docket rendered: every block of the comment body, and every limit it
 * states.
 *
 * Separate from `comment.ts` because that file owns one decision — whether a
 * comment exists at all — and separate from `comment-docket.ts` because this half
 * carries none of the counting. Everything here is a function from an already
 * folded docket to markdown, which is what lets the prose be argued about without
 * touching a single number.
 *
 * The rule every block obeys: **nothing is capped silently.** A truncated list
 * that does not say it was truncated reads as complete coverage, which is the
 * failure this whole system exists to avoid — reproduced, this time, in the one
 * artifact a human actually looks at.
 */

export function headingBlocks(report: CliRunReport, docket: Docket): readonly string[] {
  const needing = docket.reviewable + docket.failed.length;

  const heading =
    needing === 0
      ? // Reachable, and the only way to reach it is the case worth naming: a run
        // whose observations are all `unchanged` and whose report never stated
        // what it skipped. `exitFor` calls that review, and a heading claiming
        // zero findings over it would be the tool inventing the reassurance.
        '## Visual variance — this run cannot claim a clean result'
      : `## Visual variance — ${needing} subject(s) need review`;

  const meta = [
    describeIdentity(report),
    `${report.retention} retention`,
    report.at,
    ...(report.intent !== undefined ? [`intent: ${report.intent}`] : []),
  ].join(' · ');

  return [heading, meta];
}

/**
 * The docket itself: causes, then one sentence counting everything else.
 *
 * The order is the product. A reviewer who reads only the first entry has read
 * the edit; a reviewer who reads only the collateral line has read a number they
 * can size. Reverse the two and they have read three hundred lines about a
 * padding change and stopped before reaching the token that caused it.
 */
export function causeBlocks(docket: Docket, limits: CommentLimits): readonly string[] {
  if (docket.causes.length === 0) return [];

  const shown = docket.causes.slice(0, limits.causes);
  const hidden = docket.causes.slice(limits.causes);

  const items = shown.map((entry, index) => causeItem(entry, index + 1, limits));

  const omitted =
    hidden.length === 0
      ? []
      : [
          `${hidden.length} further cause(s) reaching ` +
            `${hidden.reduce((sum, entry) => sum + entry.subjects.length, 0)} subject(s) ` +
            `(${hidden.reduce((sum, entry) => sum + entry.pixels, 0)}px) are not listed here; ` +
            'they are in the run report, which is not truncated.',
        ];

  return ['### Causes', items.join('\n\n'), ...omitted, ...collateralBlocks(docket.collateral)];
}

function causeItem(entry: CauseEntry, position: number, limits: CommentLimits): string {
  const reach =
    entry.namedIn === 0
      ? // Stated in a different voice, because it is a different claim. Area
        // ranks the displaced above the displacer, so this is "the biggest thing
        // that moved", and calling it the cause would be a confident attribution
        // nobody made.
        `largest changed region in ${count(entry.subjects.length, 'subject')}, ` +
        `${entry.pixels}px — no cause was named for ${entry.subjects.length === 1 ? 'it' : 'these'}, ` +
        'so this is ranked by area, which ranks the displaced above the displacer'
      : entry.namedIn === entry.subjects.length
        ? `the cause in ${count(entry.subjects.length, 'subject')}, ${entry.pixels}px`
        : `the cause in ${entry.namedIn} of ${count(entry.subjects.length, 'subject')}, ` +
          `${entry.pixels}px — in the rest it is the largest region, ranked by area`;

  const place = [
    ...locationLine(entry.files, '', 'file'),
    ...locationLine(entry.wheres, 'in ', 'place'),
  ];

  const named = entry.subjects.slice(0, limits.subjects).map(code).join(', ');
  const rest = entry.subjects.length - Math.min(entry.subjects.length, limits.subjects);
  const subjects =
    rest === 0
      ? `seen in ${named}`
      : `seen in ${named} and ${count(rest, 'other subject')} not listed`;

  return [`${position}. **${entry.label}** — ${reach}`, ...place, subjects]
    .map((line, index) => (index === 0 ? line : `    ${line}`))
    .join('\n');
}

/**
 * One location, and an honest count of the others.
 *
 * A component grouped across two hundred subjects can sit in a different landmark
 * in each of them, and printing only the first as though it were *the* place
 * would be a claim about 199 subjects nobody checked. So the first is printed and
 * the rest are counted.
 */
function locationLine(
  values: readonly string[],
  prefix: string,
  noun: string,
): readonly string[] {
  const first = values[0];
  if (first === undefined) return [];

  const others =
    values.length === 1 ? '' : ` and ${count(values.length - 1, `other ${noun}`)}`;

  return [`${prefix}${code(first)}${others}`];
}

function collateralBlocks(collateral: Collateral): readonly string[] {
  const lines: string[] = [];

  if (collateral.regions > 0) {
    lines.push(
      `Collateral: ${count(collateral.regions, 'further region')} ` +
        `(${collateral.pixels}px) in ${count(collateral.components, 'component')} ` +
        `across ${count(collateral.subjects, 'subject')} moved with the changes above. ` +
        'Counted and not listed — displacement is not an edit, and a line each would ' +
        'bury the causes.',
    );
  }

  if (collateral.unrecorded > 0) {
    // The run's own truncation, carried through rather than absorbed. Two silent
    // caps compose into a number nobody can reconstruct.
    lines.push(
      `The run itself did not record ${count(collateral.unrecorded, 'smaller region')} ` +
        `(${collateral.unrecordedPixels}px); they are counted in the report and listed nowhere.`,
    );
  }

  return lines;
}

/**
 * Subjects with a verdict and nothing to point at.
 *
 * `new` and `incomparable` are the two that a reader — or an agent — will
 * otherwise treat as failures of the code, and neither is about the code. They
 * need review anyway: nobody has agreed what a new subject should look like, and
 * an incomparable one is a comparison that was *refused*, which is not the same
 * sentence as "no difference".
 */
export function withoutCauseBlocks(docket: Docket, limits: CommentLimits): readonly string[] {
  if (docket.withoutCause.length === 0) return [];

  const items = docket.withoutCause.map((group) => {
    const named = group.subjects.slice(0, limits.subjects).map(code).join(', ');
    const rest = group.subjects.length - Math.min(group.subjects.length, limits.subjects);

    return (
      `- **${group.verdict}** — ${count(group.subjects.length, 'subject')}: ${group.because}\n` +
      `    ${named}${rest === 0 ? '' : ` and ${count(rest, 'other')} not listed`}`
    );
  });

  return ['### Not compared', items.join('\n')];
}

/**
 * What the run did not look at, and what that does to the sentence above.
 *
 * `failed` entries are listed, because each has its own reason and a count of
 * them tells a reviewer nothing they can act on. `excluded` entries are counted
 * only: the operator already decided, in a file that was already reviewed, and
 * re-litigating that decision on every pull request is how an exclusion list ends
 * up deleted rather than read.
 */
export function coverageBlocks(
  report: CliRunReport,
  docket: Docket,
  limits: CommentLimits,
): readonly string[] {
  if (report.notObserved === undefined) {
    return [
      '### Coverage',
      'This report does not state which subjects it did not observe, so silence about a ' +
        'subject here cannot be read as a pass. That alone is why this comment exists.',
    ];
  }

  if (docket.failed.length === 0 && docket.excluded === 0) return [];

  const shown = docket.failed.slice(0, limits.notObserved);
  const hidden = docket.failed.length - shown.length;

  // Separate blocks rather than one joined string: a bare sentence on the line
  // after a list item is absorbed into that item by every markdown renderer, and
  // the excluded count would then read as a property of whichever subject
  // happened to be last.
  return [
    '### Not observed',
    ...(docket.failed.length === 0
      ? []
      : [
          [
            `${count(docket.failed.length, 'subject')} the run meant to observe and could not — ` +
              'not a pass:',
            ...shown.map((entry) => `- ${code(entry.subject)} — ${entry.because}`),
            ...(hidden === 0
              ? []
              : [`- and ${count(hidden, 'other')} not listed; the run report has all of them.`]),
          ].join('\n'),
        ]),
    ...(docket.excluded === 0
      ? []
      : [
          `${count(docket.excluded, 'subject')} excluded by configuration and not listed; ` +
            'an exclusion is a decision that was already made.',
        ]),
  ];
}

/**
 * Run-level complaints, plus the one per-subject warning that invalidates images.
 *
 * A missing font is not cosmetic. The renderer substituted something, so the
 * metrics in those images are not the product's, and a reviewer approving them by
 * eye is approving a screenshot of a different layout.
 */
export function warningBlocks(report: CliRunReport, docket: Docket): readonly string[] {
  const fonts = [...docket.missingFonts.entries()].map(
    ([font, subjects]) =>
      `- the renderer lacked ${code(font)} in ${count(subjects, 'subject')}; those images ` +
      "are of a substituted font and their metrics are not the product's",
  );
  const stated = (report.warnings ?? []).map((warning) => `- ${warning}`);

  const lines = [...fonts, ...stated];
  return lines.length === 0 ? [] : ['### Warnings', lines.join('\n')];
}

export function footerBlocks(options: CommentOptions): readonly string[] {
  return [
    [
      ...(options.runUrl === undefined
        ? []
        : [`Full report and images: ${options.runUrl}`]),
      '`variance report --subject <id>` answers about any one subject from the same artifact, ' +
        'without re-running — including the collateral this comment only counted.',
    ].join('  \n'),
  ];
}

/**
 * Cut the body to fit, and say by how much.
 *
 * GitHub does not truncate an over-long comment, it rejects the request — so the
 * real choice is between a body that states what it dropped and no comment at
 * all. The marker is the first line, so head-truncation always leaves the poster
 * able to find and update this comment on the next run; a tail-truncating
 * implementation would strand it and start duplicating.
 *
 * The room reserved for the notice is computed against the largest number it
 * could ever state, so the notice can only get shorter than the space kept for
 * it. Slightly wasteful and provably safe, which is the correct trade for a
 * length check whose failure mode is a rejected API call nobody sees.
 */
export function clamp(body: string, characters: number): string {
  if (body.length <= characters) return body;

  const notice = (dropped: number): string =>
    `\n\n> ${dropped} character(s) of this docket are not shown: the body exceeded the ` +
    `${characters}-character comment limit. Nothing was dropped from the run report itself.`;

  const room = Math.max(0, characters - notice(body.length).length);
  const cut = body.slice(0, room);
  const lastBreak = cut.lastIndexOf('\n');
  const head = lastBreak > 0 ? cut.slice(0, lastBreak) : cut;

  return head + notice(body.length - head.length);
}

function describeIdentity(report: CliRunReport): string {
  const { renderer, engine, platform, deviceScaleFactor } = report.identity;
  return `${renderer} (${engine}, ${platform}, ${deviceScaleFactor}x)`;
}
