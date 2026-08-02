import { EXIT_CLEAN, exitFor } from '../exit.js';
import type { ObservationRecord, RegionRecord } from '@variance-authority/report';
import type { CliRunReport, NotObserved } from './run.js';

/**
 * The run report as a pull-request comment — the docket, put where acting on it
 * is cheap.
 *
 * A report written to a file that nobody opens has the value of no report, so the
 * finding has to travel to the review. What travels is not the report: a comment
 * is read in eight seconds by somebody who came to merge, and every line spent on
 * something they cannot act on is a line spent making them stop reading.
 *
 * Four decisions follow from that, and each of them is a refusal.
 *
 * **The comment leads with causes and counts collateral.** A token change that
 * reaches three hundred subjects is *one* review item with the number 300 next to
 * it, never three hundred lines. This is the same argument `rankRegions` makes at
 * the region level and it is worth restating, because the failure it prevents is
 * the one that kills these tools: area measures displacement, not cause, so a
 * report ordered by how much moved leads with whatever the edit pushed around and
 * buries the edit. Scaled to a suite, ordering by *incidence* does the same thing
 * — the 300 collateral subjects outnumber the one changed component 300:1 and win
 * every list they are allowed into. So collateral is counted here and listed
 * nowhere, and the count is what makes the omission legible: "612 further regions
 * moved with these changes" is a fact a reviewer can size, while their absence
 * without a number would be indistinguishable from their non-existence.
 *
 * **The comment exists exactly when the check is red, and one function decides
 * both.** {@link exitFor} owns the question. A second rule here — say, "comment
 * when something changed" — would drift from it on the cases that matter most:
 * a run where every subject failed to render changes nothing and must still be
 * reviewed, and a report that never stated what it skipped cannot support the
 * sentence "nothing needs review". Either drift direction is fatal in the same
 * way: a red check with no comment sends a reviewer to the log to find out why,
 * and a comment with a green check teaches them the comment is advisory.
 *
 * **The marker is in the body.** The poster finds its own previous comment by
 * searching for {@link COMMENT_MARKER} and rewrites that one, because a new
 * comment per run buries the current state under a history nobody reads. Matching
 * on the *body* rather than on the author is what makes this work under any
 * token — a GITHUB_TOKEN posts as `github-actions[bot]`, a PAT posts as a person,
 * and a rule keyed on either one silently starts duplicating when the operator
 * changes the credential. The cost is stated in `post-comment.mjs`: anyone able
 * to comment on the PR can write the marker into a comment of their own and have
 * this action adopt it.
 *
 * **Nothing is capped silently.** Every list here has a limit, because a comment
 * GitHub refuses to render is a comment nobody reads, and every limit states what
 * it hid and how much of it there was. A truncated list that does not say it was
 * truncated reads as complete coverage, which is the failure this whole system
 * exists to avoid — reproduced, this time, in the one artifact a human actually
 * looks at.
 *
 * ## Pure, and deliberately so
 *
 * Report in, string out. No network, no octokit, no clock, no filesystem — and no
 * runtime import beyond `../exit.js`, which itself imports nothing. That is not
 * tidiness: it is what lets the composite action render the body in a Node
 * process that never loads a browser driver, and what lets every claim above be a
 * unit test over a hand-built report instead of a job on a real pull request.
 */

/**
 * The string the poster searches for, and the reason it may never change
 * casually.
 *
 * An HTML comment, so it is invisible in the rendered body and survives a round
 * trip through GitHub's markdown. Versioned, because the day this format changes
 * incompatibly the honest move is to leave the old comment where it is and start
 * a new one rather than rewrite a body whose shape the new renderer never
 * produced — but note what that costs: every open pull request then carries two
 * dockets, and the stale one has no way to say it is stale.
 */
export const COMMENT_MARKER = '<!-- variance-authority: pr-docket v1 -->';

/**
 * Where each list stops, and therefore where the comment starts saying so.
 *
 * `characters` is GitHub's own limit on an issue-comment body. Exceeding it does
 * not truncate the comment, it rejects the request — so the choice is between
 * cutting the body here with a statement of what was cut, and delivering nothing
 * at all. The other three are judgement: past roughly twenty docket entries a
 * reviewer is scrolling, and a docket nobody reaches the end of is the unreadable
 * output this format exists to replace.
 */
export interface CommentLimits {
  /** Docket entries listed before the rest are counted. */
  readonly causes: number;
  /** Subject ids named inside one entry before the rest are counted. */
  readonly subjects: number;
  /** Unobserved subjects listed before the rest are counted. */
  readonly notObserved: number;
  /** Hard ceiling on the body, including the marker and the notice. */
  readonly characters: number;
}

export const DEFAULT_LIMITS: CommentLimits = {
  causes: 20,
  subjects: 3,
  notObserved: 20,
  characters: 65_536,
};

export interface CommentOptions {
  readonly report: CliRunReport;
  /**
   * Where the full report and the images went.
   *
   * Printed when supplied, and the reason it matters is the counting: this
   * comment deliberately does not list collateral, so the reader needs somewhere
   * to go when the counted thing turns out to be the interesting one. Optional
   * because nothing here uploads anything — whether an artifact exists at all is
   * the operator's decision, made in their workflow, and inventing a link to a
   * place nobody published to would be worse than omitting it.
   */
  readonly runUrl?: string;
  readonly limits?: Partial<CommentLimits>;
}

/**
 * The comment body, or the empty string when there is nothing to review.
 *
 * Empty rather than a cheerful "no visual changes". A bot that comments on every
 * green pull request trains the team to filter it out, and the filter does not
 * distinguish the green ones from the red ones.
 */
export function renderComment(options: CommentOptions): string {
  const { report } = options;

  // The single decision point. See the note above: the comment's existence and
  // the check's colour are the same question, asked once.
  if (exitFor(report) === EXIT_CLEAN) return '';

  const limits: CommentLimits = { ...DEFAULT_LIMITS, ...options.limits };
  const docket = docketOf(report);

  const blocks = [
    COMMENT_MARKER,
    ...headingBlocks(report, docket),
    ...causeBlocks(docket, limits),
    ...withoutCauseBlocks(docket, limits),
    ...coverageBlocks(report, docket, limits),
    ...warningBlocks(report, docket),
    ...footerBlocks(options),
  ];

  return clamp(blocks.join('\n\n'), limits.characters);
}

/**
 * One review item: a cause, everywhere it is the cause.
 *
 * Keyed by component rather than by subject, which is the entire point. The same
 * `Button` edit seen in 300 stories is one of these with `subjects.length === 300`,
 * and a reviewer reads one line instead of scrolling past 299 restatements of it.
 */
interface CauseEntry {
  readonly label: string;
  readonly files: readonly string[];
  readonly wheres: readonly string[];
  readonly subjects: readonly string[];
  /**
   * Subjects in which the semantic tier actually named this a cause.
   *
   * Below `subjects.length` when some of those entries were picked by area
   * instead, and `0` when none were. Kept as a count rather than a flag because
   * the two are different claims — "this is the edit" and "this is the largest
   * thing that moved" — and printing the second in the voice of the first is
   * exactly the confident wrong attribution this repository refuses elsewhere.
   */
  readonly namedIn: number;
  readonly pixels: number;
}

/** Everything that moved without being the thing that was edited. Counted, never listed. */
interface Collateral {
  readonly regions: number;
  readonly pixels: number;
  readonly components: number;
  readonly subjects: number;
  /** Regions the run itself found and chose not to record, from `truncated`. */
  readonly unrecorded: number;
  readonly unrecordedPixels: number;
}

/** Subjects with a verdict but no region to point at, grouped by the reason. */
interface Group {
  readonly verdict: ObservationRecord['verdict'];
  readonly because: string;
  readonly subjects: readonly string[];
}

interface Docket {
  readonly causes: readonly CauseEntry[];
  readonly collateral: Collateral;
  readonly withoutCause: readonly Group[];
  /** Observations whose verdict is not `unchanged`. */
  readonly reviewable: number;
  readonly failed: readonly NotObserved[];
  readonly excluded: number;
  /** Font family → how many subjects were rendered without it. */
  readonly missingFonts: ReadonlyMap<string, number>;
}

interface CauseAccumulator {
  label: string;
  readonly files: Set<string>;
  readonly wheres: Set<string>;
  readonly subjects: string[];
  namedIn: number;
  pixels: number;
}

/**
 * Fold a run report into a docket: one entry per cause, everything else counted.
 *
 * The lead region is `the first region marked cause, else the first region at
 * all`, and the fallback is the load-bearing half. `rankRegions` sorts causes
 * first and area second, so when the semantic tier named nothing — a profile
 * without provenance, a change with no traceable root — every region comes back
 * `cause: false` and the subject would have no entry at all. Dropping it would be
 * a changed subject that appears in no list, which is the one outcome forbidden
 * everywhere else in this system. So it gets an entry built from its largest
 * region, and {@link CauseEntry.namedIn} records that nothing named it, so the
 * rendering can say "largest region" rather than "the cause".
 */
function docketOf(report: CliRunReport): Docket {
  const causes = new Map<string, CauseAccumulator>();
  const groups = new Map<string, { verdict: ObservationRecord['verdict']; because: string; subjects: string[] }>();
  const missingFonts = new Map<string, number>();
  const collateralComponents = new Set<string>();
  const collateralSubjects = new Set<string>();

  let reviewable = 0;
  let collateralRegions = 0;
  let collateralPixels = 0;
  let unrecorded = 0;
  let unrecordedPixels = 0;

  for (const observation of report.observations) {
    for (const font of observation.missingFonts ?? []) {
      missingFonts.set(font, (missingFonts.get(font) ?? 0) + 1);
    }

    if (observation.verdict === 'unchanged') continue;
    reviewable += 1;

    const lead = observation.regions.find((region) => region.cause) ?? observation.regions[0];

    if (lead === undefined) {
      // `new`, `incomparable`, and anything the cheap tiers settled: a verdict
      // with no geometry behind it. Grouped by the reason rather than listed one
      // per subject, because 300 subjects with no baseline share one sentence and
      // repeating it 300 times says nothing the count does not.
      const key = `${observation.verdict} ${observation.because}`;
      const group = groups.get(key) ?? {
        verdict: observation.verdict,
        because: observation.because,
        subjects: [],
      };
      group.subjects.push(observation.subject);
      groups.set(key, group);
      continue;
    }

    const key = keyOf(lead);
    const entry = causes.get(key) ?? {
      label: labelOf(lead),
      files: new Set<string>(),
      wheres: new Set<string>(),
      subjects: [],
      namedIn: 0,
      pixels: 0,
    };

    entry.subjects.push(observation.subject);
    entry.pixels += lead.pixels;
    if (lead.cause) entry.namedIn += 1;
    if (lead.file !== undefined) entry.files.add(lead.file);
    if (lead.where !== undefined) entry.wheres.add(lead.where);
    causes.set(key, entry);

    for (const region of observation.regions) {
      if (region === lead) continue;
      collateralRegions += 1;
      collateralPixels += region.pixels;
      collateralComponents.add(keyOf(region));
      collateralSubjects.add(observation.subject);
    }

    if (observation.truncated !== undefined) {
      unrecorded += observation.truncated.regions;
      unrecordedPixels += observation.truncated.pixels;
    }
  }

  const entries = [...causes.values()]
    .map((entry) => ({
      label: entry.label,
      files: [...entry.files],
      wheres: [...entry.wheres],
      subjects: entry.subjects,
      namedIn: entry.namedIn,
      pixels: entry.pixels,
    }))
    // Named causes first, then reach, then pixels. Reach before pixels because
    // the question a reviewer is answering is "how much of the product does this
    // touch", and one enormous region in one story is a smaller decision than a
    // small region in two hundred.
    .sort(
      (a, b) =>
        Number(b.namedIn > 0) - Number(a.namedIn > 0) ||
        b.subjects.length - a.subjects.length ||
        b.pixels - a.pixels,
    );

  const notObserved = report.notObserved ?? [];

  return {
    causes: entries,
    collateral: {
      regions: collateralRegions,
      pixels: collateralPixels,
      components: collateralComponents.size,
      subjects: collateralSubjects.size,
      unrecorded,
      unrecordedPixels,
    },
    withoutCause: [...groups.values()],
    reviewable,
    failed: notObserved.filter((entry) => entry.kind === 'failed'),
    excluded: notObserved.filter((entry) => entry.kind === 'excluded').length,
    missingFonts,
  };
}

/**
 * The key two regions must share to be one review item.
 *
 * `component` first, because that is the thing a person edits. `path` is the
 * fallback for a tree with no provenance — an address rather than a name, but a
 * stable one. Unattributed regions collapse to a single key on purpose: three
 * hundred regions no box contained is one finding ("the scale or the origin is
 * wrong"), not three hundred.
 */
function keyOf(region: RegionRecord): string {
  if (region.unattributed === true) return ' unattributed';
  return region.component ?? region.path ?? ' unknown';
}

function labelOf(region: RegionRecord): string {
  if (region.unattributed === true) {
    return 'a region no box contained — usually a wrong scale or origin, not a component';
  }
  const name = region.component ?? region.path;
  return name === undefined ? 'a region with no component and no path' : code(name);
}

function headingBlocks(report: CliRunReport, docket: Docket): readonly string[] {
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
function causeBlocks(docket: Docket, limits: CommentLimits): readonly string[] {
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
function withoutCauseBlocks(docket: Docket, limits: CommentLimits): readonly string[] {
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
function coverageBlocks(
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
function warningBlocks(report: CliRunReport, docket: Docket): readonly string[] {
  const fonts = [...docket.missingFonts.entries()].map(
    ([font, subjects]) =>
      `- the renderer lacked ${code(font)} in ${count(subjects, 'subject')}; those images ` +
      "are of a substituted font and their metrics are not the product's",
  );
  const stated = (report.warnings ?? []).map((warning) => `- ${warning}`);

  const lines = [...fonts, ...stated];
  return lines.length === 0 ? [] : ['### Warnings', lines.join('\n')];
}

function footerBlocks(options: CommentOptions): readonly string[] {
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
function clamp(body: string, characters: number): string {
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

/**
 * Text as inline code, with a fence long enough to contain it.
 *
 * Component names and landmark phrases carry content from the page under test —
 * `locate` builds a landmark from accessible names, which are whatever the
 * product renders. Interpolating that into markdown unescaped lets a heading, a
 * list marker, or raw HTML from the page rearrange the docket. Inline code
 * neutralises all of it, and the fence is sized to the longest backtick run in
 * the text so that nothing can close it early.
 *
 * Newlines are folded to spaces, because an inline span cannot contain one.
 * Nothing is removed.
 */
function code(text: string): string {
  const folded = text.replace(/\r?\n/g, ' ');
  const longest = [...folded.matchAll(/`+/g)].reduce(
    (max, match) => Math.max(max, match[0].length),
    0,
  );
  const fence = '`'.repeat(longest + 1);
  const pad = folded.startsWith('`') || folded.endsWith('`') ? ' ' : '';

  return `${fence}${pad}${folded}${pad}${fence}`;
}

/** `1 subject` / `2 subject(s)`, so a count of one does not read as a template. */
function count(value: number, noun: string): string {
  return value === 1 ? `1 ${noun}` : `${value} ${noun}(s)`;
}

function describeIdentity(report: CliRunReport): string {
  const { renderer, engine, platform, deviceScaleFactor } = report.identity;
  return `${renderer} (${engine}, ${platform}, ${deviceScaleFactor}x)`;
}
