import { clusterChanges, type Change } from '@variance-authority/report';
import type { CliRunReport } from './run.js';
import type { CommentLimits, CommentOptions } from './comment.js';
import type { CauseEntry, Collateral, Docket } from './docket.js';
import { code, count } from './comment-text.js';

/**
 * The docket rendered: every block of the comment body, and every limit it
 * states.
 *
 * Separate from `comment.ts` because that file owns one decision — whether a
 * comment exists at all — and separate from `docket.ts` because this half
 * carries none of the counting. Everything here is a function from an already
 * folded docket to markdown, which is what lets the prose be argued about without
 * touching a single number.
 *
 * The rule every block obeys: **nothing is capped silently.** A truncated list
 * that does not say it was truncated reads as complete coverage, which is the
 * failure this whole system exists to avoid — reproduced, this time, in the one
 * artifact a human actually looks at.
 */

/**
 * What a reviewer reads before deciding whether to open anything: the count, the
 * leading cause, and where to go.
 *
 * Kept to lines a phone shows without scrolling, because that is where a
 * pull-request notification is opened. Everything that qualifies the count —
 * every cause, the collateral, what was skipped, what painted the images — is in
 * the fold under it, and stays there rather than being dropped: a reviewer who
 * wants the whole docket opens one element.
 */
export function leadBlocks(docket: Docket, options: CommentOptions): readonly string[] {
  const needing = docket.reviewable + docket.failed.length;

  const heading =
    needing === 0
      ? // Reachable, and the only way to reach it is the case worth naming: a run
        // whose observations are all `unchanged` and whose report never stated
        // what it skipped. `exitFor` calls that review, and a heading claiming
        // zero findings over it would be the tool inventing the reassurance.
        '## Visual variance — this run cannot claim a clean result'
      : `## Visual variance — ${needing} subject(s) need review`;

  return [heading, ...leadLine(docket), ...footerBlocks(options)];
}

/**
 * The first cause, in the voice the docket gives it, or the first reason nothing
 * could be compared.
 *
 * An entry the semantic tier did not name is left out rather than printed here:
 * "the largest region" is a size, and a size on the first line reads as a cause.
 */
function leadLine(docket: Docket): readonly string[] {
  const [first] = docket.causes;
  if (first !== undefined && first.namedIn > 0) {
    const label = first.named ? code(first.label) : first.label;
    const at = first.files[0] === undefined ? '' : ` at ${code(first.files[0])}`;
    const more =
      docket.causes.length > 1 ? `, and ${count(docket.causes.length - 1, 'more cause')}` : '';
    return [`Cause: **${label}**${at}${more}`];
  }
  const [group] = docket.withoutCause;
  if (group !== undefined) {
    return [`**${group.verdict}** — ${count(group.subjects.length, 'subject')}: ${group.because}`];
  }
  return [];
}

/**
 * Everything the lead summarised, inside one element a reviewer opens on purpose.
 *
 * `<details>` rather than a second comment or a shorter docket: the docket's rule
 * is that nothing is capped silently, and folding keeps every line of it in the
 * body while taking it out of the first screen.
 */
export function foldBlocks(inner: readonly string[]): readonly string[] {
  return ['<details><summary>Causes, coverage and what painted the images</summary>', ...inner, '</details>'];
}

/** Which run this is and what painted it, which the reviewer needs only when a render is in doubt. */
export function metaBlocks(report: CliRunReport): readonly string[] {
  return [
    [
      describeIdentity(report),
      `${report.retention} retention`,
      report.at,
      ...(report.intent !== undefined ? [`intent: ${report.intent}`] : []),
    ].join(' · '),
  ];
}

/**
 * The docket itself: causes, then one sentence counting everything else.
 *
 * The order is the product. A reviewer who reads only the first entry has read
 * the edit; a reviewer who reads only the collateral line has read a number they
 * can size. Reverse the two and they have read three hundred lines about a
 * padding change and stopped before reaching the token that caused it.
 */
/**
 * What one command would settle, before the reviewer starts clicking.
 *
 * The docket answers *what changed*. This answers *how many decisions is that*,
 * and the two are different numbers whenever one edit reaches more than one
 * subject — which is the normal case for a design system and the case where
 * review actually breaks down. Forty screenshots presented as forty questions
 * get thirty-nine glances and one look.
 *
 * Placed after the causes rather than before them on purpose. A reviewer must
 * read what happened before being offered a way to approve it in bulk; leading
 * with the shortcut is how a gate becomes a recorder.
 *
 * Only changes that settle *every* subject they reach get a command. Where a
 * shape appears beside something else, `accept --shape` refuses by name, and
 * printing the command anyway would be advertising an action that fails.
 */
export function bulkBlocks(report: CliRunReport, limits: CommentLimits): readonly string[] {
  const { changes, ungrouped } = clusterChanges(report.observations);
  const changed = report.observations.filter((o) => o.verdict === 'changed').length;

  // One change reaching one subject is not a batch, and offering a bulk command
  // for it adds a line that saves nobody anything.
  const bulk = changes.filter((change) => change.settles.length > 1);
  if (bulk.length === 0) return [];

  const shown = bulk.slice(0, limits.causes);
  const settled = new Set(shown.flatMap((change) => change.settles));

  return [
    '### One decision, several subjects',
    `${changed} changed subject(s) are ${changes.length} distinct change(s). ` +
      `Accepting the ${count(shown.length, 'shape')} below settles ` +
      `${count(settled.size, 'subject')}.`,
    shown.map(bulkItem).join('\n\n'),
    ...(bulk.length > shown.length
      ? [
          `${count(bulk.length - shown.length, 'more shape')} acceptable in bulk in the run report.`,
        ]
      : []),
    ...(ungrouped.length > 0
      ? [
          `${count(ungrouped.length, 'changed subject')} carry no difference shape, so the run ` +
            'compared without a document and they have to be reviewed one at a time.',
        ]
      : []),
  ];
}

function bulkItem(change: Change): string {
  const who = change.component ?? 'no component';
  const partial =
    change.subjects.length === change.settles.length
      ? ''
      : `\n  It also appears in ${count(change.subjects.length - change.settles.length, 'subject')} ` +
        'where something else moved too. Those are refused by name and stay for review.';

  return (
    `- **${who}**${change.file === undefined ? '' : ` — ${code(change.file)}`}\n` +
    `  Settles ${count(change.settles.length, 'subject')} (${change.pixels}px).\n` +
    `  ${code(`variance accept --shape ${change.fingerprint}`)}${partial}`
  );
}

export function causeBlocks(docket: Docket, limits: CommentLimits): readonly string[] {
  if (docket.causes.length === 0) return [];

  const shown = docket.causes.slice(0, limits.causes);
  const hidden = docket.causes.slice(limits.causes);

  const items = shown.map((entry, index) => causeItem(entry, index + 1, limits));

  const omitted =
    hidden.length === 0
      ? []
      : [
          `${hidden.length} more cause(s) reaching ` +
            `${hidden.reduce((sum, entry) => sum + entry.subjects.length, 0)} subject(s) ` +
            `(${hidden.reduce((sum, entry) => sum + entry.pixels, 0)}px) in the run report.`,
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
        `largest region in ${count(entry.subjects.length, 'subject')}, ` +
        `${entry.pixels}px; no cause named, ranked by area`
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

  const label = entry.named ? code(entry.label) : entry.label;
  return [`${position}. **${label}** — ${reach}`, ...place, subjects]
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

/** Collateral is counted and not listed: displacement is not an edit, and a line each would bury the causes. */
function collateralBlocks(collateral: Collateral): readonly string[] {
  const lines: string[] = [];

  if (collateral.regions > 0) {
    // The component clause is dropped rather than printed as zero: a tree with no
    // provenance has no components, and "in 0 component(s)" invites the reader to
    // go looking for the ones that were counted.
    const within =
      collateral.components > 0 ? `in ${count(collateral.components, 'component')} ` : '';

    lines.push(
      `Collateral: ${count(collateral.regions, 'further region')} ` +
        `(${collateral.pixels}px) ${within}` +
        `across ${count(collateral.subjects, 'subject')} moved with the changes above.`,
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
 * `failed` entries are listed, and above the fold, because each has its own
 * reason, a count of them tells a reviewer nothing they can act on, and the
 * heading counts them among what needs review. `excluded` and unreached entries
 * are counted in the fold by {@link skippedBlocks}: the operator already decided,
 * in a file that was already reviewed, and re-litigating that decision on every
 * pull request is how an exclusion list ends up deleted rather than read.
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
        'subject here cannot be read as a pass.',
    ];
  }

  if (docket.failed.length === 0) return [];

  const shown = docket.failed.slice(0, limits.notObserved);
  const hidden = docket.failed.length - shown.length;

  return [
    '### Not observed',
    [
      `${count(docket.failed.length, 'subject')} the run meant to observe and could not — ` +
        'not a pass:',
      ...shown.map((entry) => `- ${code(entry.subject)} — ${entry.because}`),
      ...(hidden === 0 ? [] : [`- ${hidden} more in the run report.`]),
    ].join('\n'),
  ];
}

/** What the run chose not to render, counted: neither is a gap in the answer. */
export function skippedBlocks(docket: Docket): readonly string[] {
  return [
    ...(docket.excluded === 0
      ? []
      : [
          `${count(docket.excluded, 'subject')} excluded by configuration and not listed.`,
        ]),
    // Stated as work avoided rather than coverage lost, because that is what it
    // is: the run read the diff and every stored baseline and concluded these
    // could not have moved. A comment that filed them beside the exclusions
    // would report the reasoning as a gap.
    ...(docket.unreached === 0
      ? []
      : [
          `${count(docket.unreached, 'subject')} not rendered because this change cannot ` +
            'reach them.',
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
      `the renderer lacked ${code(font)} in ${count(subjects, 'subject')}; those images ` +
      "are of a substituted font and their metrics are not the product's",
  );
  const stated = report.warnings ?? [];

  // An alert rather than a section, and above the fold: it decides whether the
  // images under it can be trusted at all.
  const lines = [...fonts, ...stated];
  if (lines.length === 0) return [];
  const listed = lines.length === 1 ? lines : lines.map((line) => `- ${line}`);
  return [['> [!WARNING]', ...listed.map((line) => `> ${line}`)].join('\n')];
}

/**
 * Where to look, and what to do after looking.
 *
 * The command line is the fallback for a comment with no report to link: it
 * reads a report on disk, which a reviewer on a pull request does not have.
 */
export function footerBlocks(options: CommentOptions): readonly string[] {
  return [
    [
      options.runUrl === undefined
        ? 'Per subject: `variance report --subject <id>`'
        : `[Full report and images](${options.runUrl})`,
      ...(options.toAccept === undefined ? [] : [`To accept: ${options.toAccept}`]),
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

/**
 * The one finding on the page that no reviewer of this pull request could have
 * reached, and the reason it is printed above the causes.
 *
 * Every other block answers *what moved in this run*, which is a comparison
 * between two states and is exactly what the reviewer is already looking at. This
 * answers *how far it has moved altogether*, which is a sum across approvals —
 * eleven correct approvals of 2px each are eleven correct decisions and one 22px
 * change nobody made. The reviewer about to make the twelfth is the only person
 * who can act on it, and the pull request is the only place they are standing.
 *
 * It leads rather than follows because a reviewer who has read the first cause
 * has often already left, and because it does not compete with the docket for
 * that position: it is empty on almost every run, and on the run where it is not,
 * it changes how every line under it should be read.
 *
 * The sentence itself comes from the package that owns the arithmetic, not from
 * here — the same `because` the summary and the MCP tools print. A second phrasing
 * of a number this load-bearing is how a human and an agent end up disagreeing
 * about what the record said.
 */
export function driftBlocks(report: CliRunReport, limits: CommentLimits): readonly string[] {
  const moved = Object.entries(report.drift ?? {});
  if (moved.length === 0) return [];

  const shown = moved.slice(0, limits.drift);
  const items = shown.map(([, record]) => `- ${record.because}`);

  return [
    '### Further than any single review saw',
    `${count(moved.length, 'token')} moved in this run, and the record sums every approved ` +
      'change in the window. No review saw these totals, because each of them approved one step:',
    items.join('\n'),
    ...(moved.length > shown.length
      ? [
          `${count(moved.length - shown.length, 'more drifted token')} in the run report.`,
        ]
      : []),
  ];
}
