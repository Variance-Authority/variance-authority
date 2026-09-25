// compass: variance-authority/runtime/attention
/**
 * A review, in words, for the person deciding whether to merge.
 *
 * The same counts are printed as text for a terminal and as markdown for a
 * pull request comment or a job summary. The markdown starts with a marker
 * line, so a workflow finds its own comment and edits it, not posting a second
 * one on every push. The first lines are the counts a reviewer acts on: the
 * changed code no case covered, and the changed code only tests further than
 * one import away covered. Everything else is below them, and the per-file
 * detail is folded.
 */

import type { ReviewFormat } from '../review-args.js';
import { motionText } from './covering-motion.js';
import { REACHES, type Reach, type Review, type ReviewFile, type ReviewRegion } from './review.js';

/** The first line of the markdown, which a workflow looks for to edit its own comment. */
export const REVIEW_MARKER = '<!-- variance-authority: review -->';

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
    lines.push('', 'Changed regions (new in brackets):');
    for (const [kind, all, written] of reach) lines.push(`  ${`${all}`.padStart(5)} (${written})  ${REACH_TEXT[kind]}`);
  }
  lines.push(...casesText(review.files, (code) => code));
  lines.push(...beforeText(review, (code) => code), ...beyondText(review, (code) => code));
  lines.push(...motionText(review.motion));
  const detail = review.files.flatMap((file) =>
    outermost(file).filter(worthNaming).map((region) => `  ${file.file}:${region.startLine}-${region.endLine} ${
      region.name === '' ? region.kind : `${region.kind} ${region.name}`
    } — ${REACH_TEXT[region.reach]}${region.written ? ' (new)' : ''}`));
  if (detail.length > 0) lines.push('', 'Regions not covered by a test one import away:', ...detail);
  return `${lines.join('\n')}\n`;
}

function markdown(review: Review): string {
  const code = (value: string): string => `\`${value}\``;
  const lines = [REVIEW_MARKER, '### What this change did', '', header(review, code), '', ...summary(review, code)];
  const edits = editRows(review.files);
  if (edits.length > 0) {
    lines.push('', '| Edit | Files |', '| --- | ---: |', ...edits.map(([label, count]) => `| ${label} | ${count} |`));
  }
  const reach = reachRows(review.files);
  if (reach.length > 0) {
    lines.push('', '| Changed regions | All | New |', '| --- | ---: | ---: |');
    for (const [kind, all, written] of reach) lines.push(`| ${REACH_TEXT[kind]} | ${all} | ${written} |`);
  }
  lines.push(...casesText(review.files, code));
  lines.push(...beforeText(review, code), ...beyondText(review, code));
  const motion = motionText(review.motion).filter((line) => line !== '');
  if (motion.length > 0) {
    lines.push('', '<details><summary>Cases changed against the base</summary>', '', '```', ...motion, '```', '', '</details>');
  }
  const files = review.files.filter((file) => file.regions !== undefined || file.verdict !== undefined || file.unread !== undefined || file.created === true);
  if (files.length > 0) {
    lines.push('', '<details><summary>Each changed file</summary>', '');
    lines.push('| File | Edit | Regions |', '| --- | --- | --- |');
    for (const file of files) lines.push(`| ${code(file.file)} | ${editOf(file, code)} | ${regionsOf(file)} |`);
    lines.push('', '</details>');
  }
  return `${lines.join('\n')}\n`;
}

function header(review: Review, code: (value: string) => string = (value) => value): string {
  const from = code(review.from.slice(0, 12));
  const where = review.base === 'since'
    ? `Changes since ${from}.`
    : `Changes since ${from}, the commit the recording was at before these runs.`;
  const runs = review.runs;
  if (runs === undefined) return where;
  return `${where} ${runs.runs} run${runs.runs === 1 ? '' : 's'}${
    runs.commit === undefined ? '' : ` at ${code(runs.commit.slice(0, 12))}`
  } recorded ${runs.files.length} test file${runs.files.length === 1 ? '' : 's'}.`;
}

/** The counts a reviewer acts on, first. */
function summary(review: Review, code: (value: string) => string): readonly string[] {
  const regions = review.files.flatMap(outermost);
  const unrecorded = review.files
    .filter((file) => file.recorded === false && file.cases === undefined)
    .filter((file) => file.verdict !== undefined || file.unread !== undefined || file.created === true)
    .map((file) => code(file.file));
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
  const written = regions.filter((region) => region.written);
  const holding = review.files.filter((file) => outermost(file).length > 0).length;
  const lines = [
    `${regions.length} changed region${regions.length === 1 ? '' : 's'} in ${holding} file${
      holding === 1 ? '' : 's'
    }, ${written.length} of them new.`,
    `- ${uncovered.length} no case covered${
      uncovered.length === 0 ? '' : `, ${uncovered.filter((region) => region.written).length} of them new`
    }.`,
    `- ${far.length} covered only by tests further than one import away.`,
  ];
  const unplaced = regions.filter((region) => region.reach === 'unplaced').length;
  if (unplaced > 0) lines.push(`- ${unplaced} covered by tests the import graph does not hold, so how far is not known.`);
  lines.push(...absent);
  const counts = review.motion?.moved?.counts;
  if (counts !== undefined) {
    lines.push(`- Against the base: ${counts.gained} region${counts.gained === 1 ? '' : 's'} gained cases, ${
      counts.lost + counts.hidden
    } lost every case, ${counts.thinned} kept fewer.`);
  }
  return lines;
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
      return [reach, matched.length, matched.filter((region) => region.written).length] as const;
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

/** Changed files the tests declare as preconditions: every test that declares one depends on it without importing it. */
function beforeText(review: Review, code: (value: string) => string): readonly string[] {
  if (review.before === undefined || review.before.length === 0) return [];
  return [
    '',
    `Before any import: ${review.before.length} changed file${review.before.length === 1 ? '' : 's'} the tests declare as a precondition.`,
    ...review.before.map((file) => `- ${code(file.file)}: ${file.tests} of ${review.suite} test files`),
  ];
}

/** What the install changed, which no import in this repository shows. */
function beyondText(review: Review, code: (value: string) => string): readonly string[] {
  const beyond = review.beyond;
  if (beyond === undefined) return [];
  if ('whole' in beyond) return ['', `Installed packages: could not be compared (${beyond.whole}).`];
  const lines: string[] = [];
  if (beyond.packages.length > 0) {
    lines.push('', `Installed packages changed: ${beyond.packages.map(code).join(', ')}.`);
  }
  if (beyond.moved.length > 0) {
    lines.push('', `Manifests whose entry points changed: ${beyond.moved.map(code).join(', ')}.`);
  }
  return lines;
}

function editOf(file: ReviewFile, code: (value: string) => string): string {
  if (file.created === true) return 'new file';
  if (file.unread !== undefined) return `not read (${file.unread})`;
  if (file.verdict === undefined) return '';
  const label = EDITS.find(([verdict]) => verdict === file.verdict)![1];
  return file.names === undefined ? label : `${label}: ${file.names.map(code).join(', ')}`;
}

/**
 * The regions a reader counts: each one whose answer differs from the region
 * around it. A function no case covered is one finding, not one per branch
 * inside it. The JSON keeps every region.
 */
function outermost(file: ReviewFile): readonly ReviewRegion[] {
  const regions = [...(file.regions ?? [])]
    .sort((left, right) => left.startLine - right.startLine || right.endLine - left.endLine);
  const kept: ReviewRegion[] = [];
  const open: ReviewRegion[] = [];
  for (const region of regions) {
    while (open.length > 0 && open.at(-1)!.endLine < region.startLine) open.pop();
    if (open.at(-1)?.reach !== region.reach) kept.push(region);
    open.push(region);
  }
  return kept;
}

/** A region the reader should look at by name: not near, and not a module's own top level, which loads with any import. */
function worthNaming(region: ReviewRegion): boolean {
  return region.reach !== 'near' && !(region.kind === 'module' && region.reach === 'loaded');
}

function regionsOf(file: ReviewFile): string {
  if (file.regions === undefined) return '';
  const regions = outermost(file);
  return REACHES
    .map((reach) => [reach, regions.filter((region) => region.reach === reach).length] as const)
    .filter(([, count]) => count > 0)
    .map(([reach, count]) => `${count} ${reach}`)
    .join(', ');
}
