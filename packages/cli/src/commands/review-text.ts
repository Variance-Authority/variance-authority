// compass: variance-authority/runtime/attention
/**
 * A review, in words, for the person deciding whether to merge.
 *
 * The same counts are printed as text for a terminal and as markdown for a
 * pull request comment or a job summary. The markdown starts with a marker
 * line, so a workflow finds its own comment and edits it, not posting a second
 * one on every push. The text leads with the counts a reviewer acts on; the
 * markdown leads with the changed functions no case ran, by name, and folds
 * everything else.
 */

import { reviewCoverageDetails, reviewCoverageSummary } from './review-coverage.js';
import { formatCoverage } from './coverage-text.js';
import type { ReviewFormat } from '../review-args.js';
import { clampComment, COMMENT_CHARACTERS } from './comment-text.js';
import { functionsIn, motionText } from './covering-motion.js';
import { installLines } from './review-install.js';
import { caseTree, functionsMarkdown, namedList, outermost, uncoveredFunctions, uncoveredMarkdown } from './review-scope.js';
import { REACHES, type Reach, type Review, type ReviewFile, type ReviewRegion } from './review.js';
import { describeDistance } from './share.js';

/** The first line of the markdown, which a workflow looks for to edit its own comment. */
export const REVIEW_MARKER = '<!-- variance-authority: review -->';

/** Moved regions, and test files whose reach moved, listed in the comment before the rest are counted. */
const MOTION_LISTED = 40;

const EDITS = [
  ['none', 'no change to what runs: comments, types, formatting'],
  ['bodies', 'function bodies only'],
  ['values', 'top-level values'],
  ['load', 'what the module loads'],
] as const;

const REACH_TEXT: Readonly<Record<Reach, string>> = {
  near: 'covered by a test that imports the file, or is the file',
  far: 'covered only by tests further than one import away',
  unplaced: 'covered by tests the import graph does not hold, so how far is not known',
  loaded: 'ran only while its module loaded',
  hole: 'no case covered it, and a case that could have stopped first',
  unwalked: 'no case covered it',
  unknown: 'no case covered it, and the record cannot say whether one stopped first',
};

export function formatReview(review: Review, format: ReviewFormat): string {
  if (format === 'json') return `${JSON.stringify(review, undefined, 2)}\n`;
  return format === 'markdown' ? markdown(review) : text(review);
}

function text(review: Review): string {
  const lines = [header(review), '', ...summary(review, (code) => code)];
  const edits = editRows(review.files);
  if (edits.length > 0) lines.push('', 'Edits:', ...edits.map(([label, count]) => `  ${count.padStart(5)}  ${label}`));
  const reach = reachRows(review.files);
  if (reach.length > 0) {
    lines.push('', 'Changed regions (new or moved in brackets):');
    for (const [kind, all, written] of reach) lines.push(`  ${`${all}`.padStart(5)} (${written})  ${REACH_TEXT[kind]}`);
  }
  lines.push(...casesText(review.files, (code) => code));
  lines.push(...beforeText(review, (code) => code), ...installLines(review, (code) => code, false));
  lines.push(...motionText(review.motion));
  const detail = review.files.flatMap((file) =>
    outermost(file).filter(worthNaming).map((region) => `  ${file.file}:${region.startLine}-${region.endLine} ${
      region.name === '' ? region.kind : `${region.kind} ${region.name}`
    } — ${REACH_TEXT[region.reach]} (${editText(region)})`));
  if (detail.length > 0) lines.push('', 'Regions not covered by a test one import away:', ...detail);
  for (const reading of review.coverage ?? []) {
    lines.push('', 'missed' in reading ? `${reading.suite ?? 'the record'}: coverage unavailable: ${reading.missed}` : formatCoverage(reading, 'text').trimEnd());
  }
  return `${lines.join('\n')}\n`;
}

/** A region's edit, as the text format says it. */
function editText(region: ReviewRegion): string {
  return region.edit === 'moved' ? `moved from ${region.movedFrom ?? 'the same file'}` : region.edit;
}

/**
 * One mark per answer, so a row in the table and a count in the per-file fold
 * read the same way: red is changed code no case covered, yellow and orange are
 * covered from further away than the file's own importers, green is covered
 * from one import away.
 */
const MARK: Readonly<Record<Reach, string>> = {
  near: '🟢',
  far: '🟡',
  unplaced: '🟠',
  loaded: '⚪',
  hole: '🔴',
  unwalked: '🔴',
  unknown: '🔴',
};

/** What each mark says, once, above the first place it is used. */
const LEGEND = '🟢 a test importing the file ran it · 🟡 only tests further away ran it · 🟠 tests outside the import graph ran it · ' +
  '⚪ ran only while its module loaded · 🔴 no case ran it';

/**
 * The comment, disclosed a level at a time. The first screen is the verdict:
 * which changed functions hold code no case ran, what the change cost against
 * the base, and how much of the suite ran. Everything a reader or an agent
 * would dig for — each location, the cases that ran each function by title,
 * the cases added — is one fold down, and what is rarely read is two. Before
 * the change has run, the same answers say what it might move.
 *
 * The comment is posted as it is written, so it is cut to GitHub's limit here,
 * where the notice can say where the whole review is. One character is kept
 * for the final line break.
 */
function markdown(review: Review): string {
  const code = (value: string): string => `\`${value}\``;
  const mark = (region: ReviewRegion): string => MARK[region.reach];
  const ran = review.record === 'ran';
  const lines = [REVIEW_MARKER, review.coverage === undefined ? `### 🧭 What this change ${ran ? 'did' : 'might do'}` : '### Test evidence', '', `<sub>${markdownHeader(review, code)}${
    ran ? '' : ' The record was made before this change, so it names the cases that stood on the changed lines.'
  }</sub>`, ''];
  lines.push(...calloutMarkdown(review), ...casesMarkdown(review.files, code));
  lines.push(...(ran ? selectionMarkdown(review, code) : []), ...lostMarkdown(review, code));
  if (review.coverage !== undefined) lines.push(...reviewCoverageSummary(review.coverage));
  if (review.before !== undefined && review.before.length > 0) {
    lines.push('', ...review.before.map((file) => `⚙️ ${code(file.file)} changed, and ${
      file.tests !== review.suite ? `${file.tests} of ${review.suite} test files load` : file.tests === 1 ? 'the one test file loads' : `all ${file.tests} test files load`
    } it before any import.`));
  }
  lines.push(...installLines(review, code, true));
  const uncovered = uncoveredMarkdown(review, mark);
  const functions = functionsMarkdown(review, mark);
  if (uncovered.length + functions.length > 0) lines.push('', `<sub>${LEGEND}</sub>`);
  lines.push(...uncovered, ...functions);
  if (review.coverage !== undefined) lines.push(...reviewCoverageDetails(review.coverage));
  const more: string[] = [];
  const said: string[] = [];
  const unrecorded = unrecordedFiles(review);
  if (unrecorded.length > 0) {
    said.push('files not in the record');
    more.push('', `<details><summary>🗂️ ${unrecorded.length} changed file${unrecorded.length === 1 ? '' : 's'} not in the record, so not counted</summary>`, '');
    more.push(...unrecorded.map((file) => `- ${code(file)}`), '', '</details>');
  }
  const motion = motionText(review.motion, undefined, MOTION_LISTED).filter((line) => line !== '');
  if (motion.length > 0) {
    said.push('cases moved against the base');
    more.push('', '<details><summary>🔀 Cases moved against the base</summary>', '', '```', ...motion, '```', '', '</details>');
  }
  const files = review.files.filter((file) => file.regions !== undefined || file.verdict !== undefined || file.unread !== undefined || file.created === true);
  if (files.length > 0) {
    said.push('each changed file');
    more.push('', `<details><summary>📄 Each changed file</summary>`, '');
    more.push('| File | Edit | Regions |', '| --- | --- | --- |');
    for (const file of files) more.push(`| ${code(file.file)} | ${fileEdit(file, code)} | ${marksOf(file)} |`);
    more.push('', '</details>');
  }
  if (more.length > 0) lines.push('', `<details><summary>Recording scope and limitations: ${said.join(', ')}</summary>`, ...more, '', '</details>');
  return `${clampComment(lines.join('\n'), COMMENT_CHARACTERS - 1, (dropped) =>
    `\n\n> ${dropped} characters of this review are not shown, because GitHub rejects a comment longer than ${COMMENT_CHARACTERS}. ` +
    '`--format json` prints the whole review, and `--out` writes it to `review.json`.')}\n`;
}

/**
 * The verdict as a GitHub alert, in functions a reader knows by name: a
 * warning when changed code ran under no case, a note when the record, made
 * before the change, holds no case for it.
 */
function calloutMarkdown(review: Review): readonly string[] {
  const regions = review.files.flatMap(outermost);
  if (regions.length === 0) {
    const inert = review.files.filter((file) => file.verdict === 'none').length;
    return [`${review.files.length} changed file${review.files.length === 1 ? '' : 's'}, and no changed region the record covers${
      inert > 0 ? `; ${inert} of them change nothing that runs` : ''
    }.`];
  }
  const ran = review.record === 'ran';
  const { total, names } = uncoveredFunctions(review);
  if (names.length > 0) {
    const has = names.length === 1 ? 'has' : 'have';
    return [
      ran ? '> [!WARNING]' : '> [!NOTE]',
      `> **${names.length} of ${total} changed function${total === 1 ? '' : 's'} ${has} code ${ran ? 'no case ran' : 'the record holds no case for'}:** ${namedList(names)}.`,
    ];
  }
  const every = total === 0 ? `${regions.length} changed region${regions.length === 1 ? '' : 's'}` : `${total} changed function${total === 1 ? '' : 's'}`;
  return ['> [!TIP]', `> Every one of the ${every} ${ran ? 'ran under a case' : 'has a case in the record'}.`];
}

/**
 * The changed code that lost every case against the base, by function, and how
 * much is run by fewer cases. When no case index written by the runs names the
 * test files they ran, there is no base to lose against, and the line says so.
 */
function lostMarkdown(review: Review, code: (value: string) => string): readonly string[] {
  const moved = review.motion?.moved;
  const unwritten = review.motion?.unwritten?.length ?? 0;
  const at = runsAt(review, code);
  if (review.motion?.lastRunUnread !== undefined) {
    return ['', `Which test files a run ${at} wrote to the case index could not be read, so no case is compared against the base.`];
  }
  if (moved === undefined) {
    if (unwritten === 0) return [];
    const there = review.runs?.commit === undefined ? 'in them' : 'there';
    const files = unwritten === 1 ? `the one test file run ${there}` : `the ${unwritten} test files run ${there}`;
    return ['', `No case index was written ${at} for ${files}, so no case is compared against the base.`];
  }
  const lost = moved.regions.filter((region) => region.motion === 'lost' || region.motion === 'hidden');
  const thinned = moved.counts.thinned;
  const fewer = thinned === 0 ? '' : `▽ ${thinned} changed region${thinned === 1 ? ' is' : 's are'} run by fewer cases than at the base.`;
  if (lost.length === 0) return fewer === '' ? [] : ['', fewer];
  return ['', `▼ No longer run by any case that ran them at the base: ${functionsIn(lost)}.${fewer === '' ? '' : ` ${fewer}`}`];
}

/** Where the runs this review read were made: the commit they named, or, when they named none, only that they are these runs. */
function runsAt(review: Review, code: (value: string) => string): string {
  const commit = review.runs?.commit;
  return commit === undefined ? 'in these runs' : `at ${code(commit.slice(0, 12))}`;
}

/**
 * How much of the suite ran in the runs read, against how much the snapshot
 * holds: the two counts the review already carries, so a reader sees what a
 * selected run left out and which command chose it. A run of every file names
 * the command instead. The record keeps no durations, so no time is claimed.
 */
function selectionMarkdown(review: Review, code: (value: string) => string): readonly string[] {
  const { runs, suite } = review;
  if (runs === undefined || suite === undefined || suite === 0) return [];
  const ran = runs.files.length;
  const select = code(`variance select --since ${review.from.slice(0, 12)}`);
  const at = runsAt(review, code);
  if (review.coverage !== undefined) {
    const scope = review.recordedSuite === undefined ? '' : `${code(review.recordedSuite)}: `;
    return ['', `${scope}${ran} test file${ran === 1 ? '' : 's'} ran ${at}.${ran < suite ? ` The other ${suite - ran} retain earlier recordings.` : ' Every test file in the recording ran.'}`];
  }
  if (ran >= suite) return ['', `🎯 All ${suite} test file${suite === 1 ? '' : 's'} ran ${at}. ${select} lists the ones this change reaches.`];
  return ['', `🎯 **${ran} of ${suite} test files ran** ${at}, ${ran * 100 < suite ? 'under 1' : Math.round((100 * ran) / suite)}% of the suite; the other ${
    suite - ran
  } kept the rows recorded before them. ${select} lists the files a change reaches.`];
}

function unrecordedFiles(review: Review): readonly string[] {
  return review.files
    .filter((file) => file.recorded === false && file.cases === undefined)
    .filter((file) => file.verdict !== undefined || file.unread !== undefined || file.created === true)
    .map((file) => file.file);
}

function marksOf(file: ReviewFile): string {
  if (file.regions === undefined) return '';
  const regions = outermost(file);
  return REACHES
    .map((reach) => [reach, regions.filter((region) => region.reach === reach).length] as const)
    .filter(([, count]) => count > 0)
    .map(([reach, count]) => `${MARK[reach]} ${count} ${reach}`)
    .join(' · ');
}

/**
 * Where a review from the mainline's record starts. A record published past
 * the merge base cannot be the start, so the header names both commits rather
 * than let the reader take one for the other.
 */
function mainlineHeader(start: string, mainline: NonNullable<Review['mainline']>, code: (value: string) => string): string {
  const from = code(start.slice(0, 12));
  const record = `mainline ${mainline.name} published its record of "${mainline.suite}"`;
  const where = mainline.commit === start
    ? `Changes since ${from}, where ${record}, ${describeDistance(mainline.distance)}.`
    : `Changes since ${from}, the merge base with ${code(mainline.commit.slice(0, 12))}, where ${record}, ` +
      `${describeDistance(mainline.distance)}.`;
  return mainline.casesUnread === undefined ? where : `${where} Cases are not compared with that record's: ${mainline.casesUnread}.`;
}

function header(review: Review, code: (value: string) => string = (value) => value, withRuns = true): string {
  const from = code(review.from.slice(0, 12));
  const mainline = review.mainline;
  const where = review.base === 'since'
    ? `Changes since ${from}.`
    : mainline !== undefined
      ? mainlineHeader(review.from, mainline, code)
      : `Changes since ${from}, the commit the recording was at before these runs.`;
  const runs = review.runs;
  if (runs === undefined || !withRuns) return where;
  return `${where} ${runs.runs} run${runs.runs === 1 ? '' : 's'}${
    runs.commit === undefined ? '' : ` at ${code(runs.commit.slice(0, 12))}`
  } recorded ${runs.files.length} test file${runs.files.length === 1 ? '' : 's'}.`;
}

/**
 * What the review read, for a comment: the commit, the base, the runs and the
 * recordings compared with, each by its own hash. On a pull request CI reads
 * GitHub's merge of it, which nobody pushed, so the pull request's own head is
 * named first, and the comment says it goes stale when that head moves.
 */
function markdownHeader(review: Review, code: (value: string) => string): string {
  const short = (commit: string): string => code(commit.slice(0, 12));
  const head = review.head;
  const merged = head !== undefined && head.dirty !== true && head.parents.length === 2 ? head.parents[1]! : undefined;
  const reviewed = head === undefined
    ? []
    : head.dirty === true
      ? [`Reviewed the working tree over ${short(head.commit)}.`]
      : merged !== undefined
        ? [`Reviewed ${short(merged)} (merged into ${short(head.parents[0]!)} as ${short(head.commit)} for this run).`]
        : [`Reviewed ${short(head.commit)}.`];
  const runs = review.runs?.commit;
  const cases = runs === undefined || runs === head?.commit ? [] : [`Cases ran at ${short(runs)}.`];
  const groups = new Map<string, string[]>();
  for (const reading of review.coverage ?? []) {
    if ('missed' in reading) continue;
    for (const suite of reading.suites) {
      const commit = suite.base?.commit;
      if (commit !== undefined) groups.set(commit, [...(groups.get(commit) ?? []), suite.suite ?? 'the record']);
    }
  }
  const compared = groups.size === 0
    ? []
    : [`Compared with the recordings at ${[...groups].map(([commit, suites]) => `${short(commit)} (${suites.join(', ')})`).join(' and ')}.`];
  const stale = merged === undefined ? [] : [`If the pull request's head is no longer ${short(merged)}, this review describes an earlier commit.`];
  return [...reviewed, header(review, code, false), ...cases, ...compared, ...stale].join(' ');
}

/** The counts a reviewer acts on, first. */
function summary(review: Review, code: (value: string) => string): readonly string[] {
  const regions = review.files.flatMap(outermost);
  const unrecorded = unrecordedFiles(review).map(code);
  const absent = unrecorded.length === 0 ? [] : [`- Not in the record, so not counted: ${unrecorded.join(', ')}.`];
  if (regions.length === 0) {
    const inert = review.files.filter((file) => file.verdict === 'none').length;
    return [
      `${review.files.length} changed file${review.files.length === 1 ? '' : 's'}, and no changed region the record covers${
        inert > 0 ? `; ${inert} of them change nothing that runs` : ''
      }.`,
      ...absent,
    ];
  }
  const uncovered = regions.filter((region) => region.reach === 'hole' || region.reach === 'unwalked' || region.reach === 'unknown');
  const far = regions.filter((region) => region.reach === 'far');
  const holding = review.files.filter((file) => outermost(file).length > 0).length;
  const lines = [
    `${regions.length} changed region${regions.length === 1 ? '' : 's'} in ${holding} file${holding === 1 ? '' : 's'}: ${edits(regions)}.`,
    `- ${uncovered.length} no case covered${uncovered.length === 0 ? '' : `: ${edits(uncovered)}`}.`,
    `- ${far.length} covered only by tests further than one import away.`,
  ];
  const unplaced = regions.filter((region) => region.reach === 'unplaced').length;
  if (unplaced > 0) lines.push(`- ${unplaced} covered by tests the import graph does not hold, so how far is not known.`);
  lines.push(...absent);
  const counts = review.motion?.moved?.counts;
  if (counts !== undefined) {
    lines.push(`- Against the base: ${counts.gained} region${counts.gained === 1 ? '' : 's'} newly run, ${
      counts.lost + counts.hidden
    } no longer run, ${counts.thinned} run by fewer cases.`);
  }
  return lines;
}

/** How many regions each kind of edit wrote, the kinds that wrote none left out. */
function edits(regions: readonly ReviewRegion[]): string {
  return (['new', 'modified', 'moved'] as const)
    .map((edit) => [edit, regions.filter((region) => region.edit === edit).length] as const)
    .filter(([, count]) => count > 0)
    .map(([edit, count]) => `${count} ${edit}`)
    .join(', ');
}

function editRows(files: readonly ReviewFile[]): readonly (readonly [string, string])[] {
  const rows: (readonly [string, string])[] = [];
  for (const [verdict, label] of EDITS) {
    const matched = files.filter((file) => file.verdict === verdict);
    if (matched.length === 0) continue;
    const names = verdict === 'values' ? [...new Set(matched.flatMap((file) => file.names ?? []))] : [];
    rows.push([names.length === 0 ? label : `${label}: ${names.join(', ')}`, `${matched.length}`]);
  }
  const created = files.filter((file) => file.created === true).length;
  if (created > 0) rows.push(['new files', `${created}`]);
  const unread = files.filter((file) => file.unread !== undefined).length;
  if (unread > 0) rows.push(['could not be read as a module edit', `${unread}`]);
  const other = files.filter((file) => file.verdict === undefined && file.unread === undefined && file.created === undefined).length;
  if (other > 0) rows.push(['not a module', `${other}`]);
  return rows;
}

function reachRows(files: readonly ReviewFile[]): readonly (readonly [Reach, number, number])[] {
  const regions = files.flatMap(outermost);
  return REACHES
    .map((reach) => {
      const matched = regions.filter((region) => region.reach === reach);
      return [reach, matched.length, matched.filter((region) => region.edit !== 'modified').length] as const;
    })
    .filter(([, all]) => all > 0);
}

function casesText(files: readonly ReviewFile[], code: (value: string) => string): readonly string[] {
  const changed = files.filter((file) => file.cases !== undefined && file.cases.added.length + file.cases.removed.length > 0);
  if (changed.length === 0) return [];
  const added = changed.reduce((sum, file) => sum + file.cases!.added.length, 0);
  const removed = changed.reduce((sum, file) => sum + file.cases!.removed.length, 0);
  const lines = ['', `Cases: ${added} added, ${removed} removed, in ${changed.length} test file${changed.length === 1 ? '' : 's'}.`];
  for (const file of changed) {
    lines.push(`- ${code(file.file)}: ${[
      ...file.cases!.added.map((name) => `+ ${name}`),
      ...file.cases!.removed.map((name) => `− ${name}`),
    ].join('; ')}`);
  }
  return lines;
}

/**
 * The same cases for a comment: the count as the fold's summary, and under it
 * one nested list per test file, a level for each `describe` a case sits in,
 * so a long run of titles reads as the tree the file declares.
 */
function casesMarkdown(files: readonly ReviewFile[], code: (value: string) => string): readonly string[] {
  const changed = files.filter((file) => file.cases !== undefined && file.cases.added.length + file.cases.removed.length > 0);
  if (changed.length === 0) return [];
  const added = changed.reduce((sum, file) => sum + file.cases!.added.length, 0);
  const removed = changed.reduce((sum, file) => sum + file.cases!.removed.length, 0);
  const lines = ['', `<details><summary>✏️ Cases added and removed: +${added} −${removed} in ${changed.length} test file${changed.length === 1 ? '' : 's'}</summary>`, ''];
  for (const file of changed) {
    lines.push(`- ${code(file.file)}`, ...caseTree([
      ...file.cases!.added.map((name) => ({ path: name.split(' > '), mark: '+' })),
      ...file.cases!.removed.map((name) => ({ path: name.split(' > '), mark: '−' })),
    ]));
  }
  return [...lines, '', '</details>'];
}

/** Changed files the tests declare as preconditions: every test that declares one depends on it without importing it. */
function beforeText(review: Review, code: (value: string) => string): readonly string[] {
  if (review.before === undefined || review.before.length === 0) return [];
  return [
    '',
    `Before any import: ${review.before.length} changed file${review.before.length === 1 ? '' : 's'} the tests declare as a precondition.`,
    ...review.before.map((file) => `- ${code(file.file)}: ${file.tests} of ${review.suite} test files`),
  ];
}

function fileEdit(file: ReviewFile, code: (value: string) => string): string {
  if (file.created === true) return 'new file';
  if (file.unread !== undefined) return `not read (${file.unread})`;
  if (file.verdict === undefined) return '';
  const label = EDITS.find(([verdict]) => verdict === file.verdict)![1];
  return file.names === undefined ? label : `${label}: ${file.names.map(code).join(', ')}`;
}

/** A region the reader should look at by name: not near, and not a module's own top level, which loads with any import. */
function worthNaming(region: ReviewRegion): boolean {
  return region.reach !== 'near' && !(region.kind === 'module' && region.reach === 'loaded');
}
