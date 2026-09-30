// compass: variance-authority/runtime/attention
/**
 * Where to look, as `path:start-end`: the changed code no case ran, and for
 * the rest the test files that ran it. Only the record knows either — a reader
 * of the diff, person or bot, cannot — so the comment states both as plain
 * locations any tool reading it can resolve, rather than only as counts.
 */

import type { Review, ReviewFile, ReviewRegion } from './review.js';

/** Uncovered locations named in the callout before the rest are left to the fold. */
const CALLOUT = 10;
/** Test files named per region before the rest are counted. */
const TESTS = 5;

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
  return ['>', ...lines.slice(0, CALLOUT), `> - and ${lines.length - CALLOUT} more, under 📍 below.`];
}

/** Every changed region with the test files that ran it, folded. */
export function scopeMarkdown(review: Review, mark: (region: ReviewRegion) => string): readonly string[] {
  const rows = located(review);
  if (rows.length === 0) return [];
  const bare = rows.filter(([, region]) => uncovered(region)).length;
  const lines = ['', `<details><summary>📍 The test files that ran each changed function${bare === 0 ? '' : `, and the ${bare} changed region${bare === 1 ? '' : 's'} none ran`}</summary>`, ''];
  for (const [file, region] of rows) lines.push(`- ${mark(region)} ${where(file, region)}${ranBy(region)}`);
  return [...lines, '', '</details>'];
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
      Number(uncovered(right)) - Number(uncovered(left)) || (leftFile < rightFile ? -1 : leftFile > rightFile ? 1 : 0) || left.startLine - right.startLine);
}

/** `path:line` or `path:start-end`, and what is there: a branch or loop is named by the function holding it. */
function where(file: string, region: ReviewRegion): string {
  const lines = region.startLine === region.endLine ? `${region.startLine}` : `${region.startLine}-${region.endLine}`;
  const name = region.name === '' ? region.kind : region.kind === 'function' ? `function \`${region.name}\`` : `${region.kind} in \`${region.name}\``;
  return `\`${file}:${lines}\` ${name}${region.written ? ', new' : ''}`;
}

function ranBy(region: ReviewRegion): string {
  if (uncovered(region)) return ' — no case ran it';
  if (region.tests.length === 0) return ` — ${region.cases} case${region.cases === 1 ? '' : 's'}`;
  const named = region.tests.slice(0, TESTS).map((test) => `\`${test}\``).join(', ');
  const rest = region.tests.length - TESTS;
  return ` — ${region.cases} case${region.cases === 1 ? '' : 's'} in ${named}${rest > 0 ? ` and ${rest} more test file${rest === 1 ? '' : 's'}` : ''}`;
}
