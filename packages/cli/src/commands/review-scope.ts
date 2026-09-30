// compass: variance-authority/runtime/attention
/**
 * Where to look, as `path:start-end`: the changed code no case ran, and for
 * the rest the cases that ran it, by title. Only the record knows either — a
 * reader of the diff, person or agent, cannot — so the comment states both as
 * locations and titles any tool reading it can resolve, rather than as counts.
 */

import type { Review, ReviewFile, ReviewRegion } from './review.js';

/** Uncovered locations named in the callout before the rest are left to the fold. */
const CALLOUT = 10;
/** Changed functions given a line of their own before the rest are folded. */
const FUNCTIONS = 20;
/** Case titles named under a function before the rest are counted. */
const TITLES = 30;

const UNCOVERED = new Set(['hole', 'unwalked', 'unknown']);

export function uncovered(region: ReviewRegion): boolean {
  return UNCOVERED.has(region.reach);
}

/**
 * The regions a reader counts: each one whose answer differs from the region
 * around it. A function no case covered is one finding, not one per branch
 * inside it. The JSON keeps every region.
 */
export function outermost(file: ReviewFile): readonly ReviewRegion[] {
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

/** The uncovered locations, as callout lines under the count. */
export function uncoveredCallout(review: Review): readonly string[] {
  const lines = located(review).filter(([, region]) => uncovered(region)).map(([file, region]) => `> - ${where(file, region)}`);
  if (lines.length <= CALLOUT) return lines.length === 0 ? [] : ['>', ...lines];
  return ['>', ...lines.slice(0, CALLOUT), `> - and ${lines.length - CALLOUT} more, below.`];
}

/**
 * Each changed function and the cases that ran it, one line each: the line
 * says where it is and how many, and the titles fold under it, so a reader
 * opens the one function they care about. Before the change has run, the
 * same cases are the ones it might move.
 */
export function functionsMarkdown(review: Review, mark: (region: ReviewRegion) => string): readonly string[] {
  const rows = located(review)
    .slice()
    .sort(([leftFile, left], [rightFile, right]) => order(leftFile, rightFile) || left.startLine - right.startLine);
  if (rows.length === 0) return [];
  const lines = ['', review.record === 'ran'
    ? '**What ran each changed function**'
    : '**What ran each changed function when the record was made**, so what this change might move'];
  for (const [file, region] of rows.slice(0, FUNCTIONS)) lines.push('', ...functionMarkdown(review, file, region, mark));
  const rest = rows.slice(FUNCTIONS);
  if (rest.length > 0) {
    lines.push('', `<details><summary>${rest.length} more changed function${rest.length === 1 ? '' : 's'}</summary>`, '');
    for (const [file, region] of rest) lines.push(`- ${mark(region)} ${where(file, region)}${ranBy(review, region)}`);
    lines.push('', '</details>');
  }
  return lines;
}

function functionMarkdown(review: Review, file: string, region: ReviewRegion, mark: (region: ReviewRegion) => string): readonly string[] {
  if (region.called.length === 0) return [`${mark(region)} ${where(file, region)}${ranBy(review, region)}`];
  const titled = region.called.slice(0, TITLES);
  const lines = [`<details><summary>${mark(region)} ${where(file, region, true)}${ranBy(review, region)}</summary>`, ''];
  for (const test of region.tests) {
    const names = titled.filter((called) => called.file === test);
    if (names.length === 0) continue;
    lines.push(`- \`${test}\``, ...caseTree(names.map((called) => ({ path: called.name.split(' > ') }))));
  }
  if (region.called.length > TITLES) lines.push(`- and ${region.called.length - TITLES} more cases`);
  return [...lines, '', '</details>'];
}

/**
 * Case titles as the tree their file declares: a level for each `describe` a
 * case sits in, under a list item the caller wrote for the file.
 */
export function caseTree(titled: readonly { readonly path: readonly string[]; readonly mark?: string }[]): readonly string[] {
  const lines: string[] = [];
  let open: readonly string[] = [];
  for (const { path, mark } of titled) {
    let shared = 0;
    while (shared < open.length && shared < path.length - 1 && open[shared] === path[shared]) shared += 1;
    for (let depth = shared; depth < path.length - 1; depth += 1) lines.push(`${'  '.repeat(depth + 1)}- ${path[depth]}`);
    lines.push(`${'  '.repeat(path.length)}- ${mark === undefined ? '' : `${mark} `}${path[path.length - 1]}`);
    open = path.slice(0, -1);
  }
  return lines;
}

/**
 * The uncovered regions, then every other changed function by its own answer —
 * not the outermost, which is the module's top level whenever that ran. Uncovered
 * first, then by file and line: the order a reviewer works in.
 */
function located(review: Review): readonly (readonly [string, ReviewRegion])[] {
  return review.files
    .flatMap((file) => [
      ...outermost(file).filter(uncovered),
      ...(file.regions ?? []).filter((region) => region.kind === 'function' && !region.name.includes('/') && !uncovered(region)),
    ].map((region) => [file.file, region] as const))
    .sort(([leftFile, left], [rightFile, right]) =>
      Number(uncovered(right)) - Number(uncovered(left)) || order(leftFile, rightFile) || left.startLine - right.startLine);
}

/** `path:line` or `path:start-end`, and what is there: a branch or loop is named by the function holding it. */
function where(file: string, region: ReviewRegion, html = false): string {
  const code = (value: string): string => (html ? `<code>${escape(value)}</code>` : `\`${value}\``);
  const lines = region.startLine === region.endLine ? `${region.startLine}` : `${region.startLine}-${region.endLine}`;
  const name = region.name === '' ? region.kind : region.kind === 'function' ? `function ${code(region.name)}` : `${region.kind} in ${code(region.name)}`;
  return `${code(`${file}:${lines}`)} ${name}${region.written ? ', new' : ''}`;
}

/** How many cases ran it, and in how many test files; or, with none, why none. */
function ranBy(review: Review, region: ReviewRegion): string {
  if (uncovered(region)) {
    if (review.record === 'ran') return ' — no case ran it';
    return region.written ? ' — written since the record, so not run yet' : ' — no case ran it when the record was made';
  }
  const cases = `${region.cases} case${region.cases === 1 ? '' : 's'}`;
  if (region.tests.length === 0) return ` — ${cases}`;
  return ` — ${cases} in ${region.tests.length === 1 ? '1 test file' : `${region.tests.length} test files`}`;
}

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
