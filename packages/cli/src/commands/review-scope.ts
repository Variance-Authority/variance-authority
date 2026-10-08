// compass: variance-authority/runtime/attention
/**
 * Where to look, disclosed a level at a time: first the changed functions
 * holding code no case ran, by name; then, folded, each location; and for the
 * rest one row a function, with the cases that entered it, the cases that ran
 * a line the change wrote, and the test files they are in. Only the record
 * knows any of it — a reader of the diff, person or agent, cannot — so every
 * row is a name and a location a tool reading the comment can resolve. Case
 * titles are the JSON's: a comment has a length limit and a review does not.
 */

import { valued } from '@variance-authority/sense/test-selection';
import type { Review, ReviewCase, ReviewFile, ReviewRegion } from './review.js';

/** Functions named in the first line before the rest are counted. */
const CALLOUT = 5;
/** Functions given a row before the rest are counted. */
const ROWS = 100;
/** Test files named on a row before the rest are counted. */
const TEST_FILES = 3;

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

/** The function a region sits in: a branch or a closure is its enclosing function's, and a module's own code is its top level. */
function functionOf(region: ReviewRegion): string {
  return region.kind === 'module' || region.name === '' ? 'the top level' : region.name.split('/')[0]!;
}

/**
 * The changed functions, and of them the ones holding code no case ran, by
 * name: the first thing a reader is told, before any location.
 */
export function uncoveredFunctions(review: Review): { readonly total: number; readonly names: readonly string[] } {
  const all = new Set<string>();
  const names: string[] = [];
  for (const [file, region] of located(review)) {
    const key = `${file}\0${functionOf(region)}`;
    if (uncovered(region) && !names.includes(key)) names.push(key);
    all.add(key);
  }
  return { total: all.size, names: names.map((key) => key.split('\0')[1]!) };
}

/** The named functions as a sentence's tail: the first few, and the rest counted. */
export function namedList(names: readonly string[]): string {
  const said = names.slice(0, CALLOUT).map((name) => (name === 'the top level' ? name : `\`${name}\``));
  return names.length > CALLOUT ? `${said.join(', ')} and ${names.length - CALLOUT} more` : said.join(', ');
}

/** Every location no case ran, folded under how many there are. */
export function uncoveredMarkdown(review: Review, mark: (region: ReviewRegion) => string): readonly string[] {
  const rows = located(review).filter(([, region]) => uncovered(region));
  if (rows.length === 0) return [];
  const functions = new Set(rows.map(([file, region]) => `${file}\0${functionOf(region)}`)).size;
  const why = review.record === 'ran' ? 'no case ran' : 'no case in the record';
  return [
    '',
    `<details><summary>${mark(rows[0]![1])} Where ${why}: ${rows.length} place${rows.length === 1 ? '' : 's'} in ${functions} function${functions === 1 ? '' : 's'}</summary>`,
    '',
    ...rows.map(([file, region]) => `- ${where(review, file, region)} (${editLabel(file, region)})`),
    '',
    '</details>',
  ];
}

/**
 * Each changed function a case ran, one row each: the cases that entered it,
 * the ones that ran a changed line in it, and their test files. Before the
 * change has run, the same cases are the ones it might move.
 */
export function functionsMarkdown(review: Review, mark: (region: ReviewRegion) => string): readonly string[] {
  const rows = located(review).filter(([, region]) => region.kind === 'function' && !uncovered(region));
  if (rows.length === 0) return [];
  const cases = new Set(rows.flatMap(([, region]) => region.called.map((test) => test.id))).size;
  const tests = new Set(rows.flatMap(([, region]) => region.tests)).size;
  const counted = cases === 0 ? '' : ` — ${cases} case${cases === 1 ? '' : 's'} in ${tests} test file${tests === 1 ? '' : 's'}`;
  const lines = ['', `<details><summary>🧪 ${review.record === 'ran' ? 'What ran' : 'What the record ran for'} ${rows.length} changed function${
    rows.length === 1 ? '' : 's'
  }${counted}</summary>`, '', ...unheardMarkdown(rows.flatMap(([, region]) => region.called))];
  lines.push('| | Function | Edit | Where | Cases entered | Ran a changed line | Test files |', '|---|---|---|---|--:|--:|---|');
  for (const [file, region] of rows.slice(0, ROWS)) {
    const named = region.tests.slice(0, TEST_FILES).map((test) => `\`${test}\``).join(', ');
    const more = region.tests.length > TEST_FILES ? ` and ${region.tests.length - TEST_FILES} more` : '';
    lines.push(`| ${mark(region)} | \`${region.name}\` | ${editLabel(file, region)} | ${place(review, file, region)} | ${region.cases}${spanned(region.called)} | ${
      region.changedLineCases
    } | ${named}${more} |`);
  }
  if (rows.length > ROWS) lines.push('', `${rows.length - ROWS} more function${rows.length - ROWS === 1 ? ' is' : 's are'} in the review's JSON.`);
  return [
    ...lines,
    '',
    'A case entered a function when it called into it, and ran a changed line when it entered the innermost region holding one. Case titles are in the review\'s JSON.',
    '',
    '</details>',
  ];
}

/** What kind of edit wrote a region, as a reader says it. */
function editLabel(file: string, region: ReviewRegion): string {
  if (region.edit !== 'moved') return region.edit;
  return region.movedFrom === undefined || region.movedFrom === file ? 'moved within the file' : `moved from \`${region.movedFrom}\``;
}

/**
 * How many of the cases the record did not listen to for preconditions. A case
 * that said nothing prints bare, and so does one nobody listened to, so the
 * second is counted here rather than read as the first — the way `covering
 * --where` answers it.
 */
function unheardMarkdown(called: readonly ReviewCase[]): readonly string[] {
  const heard = new Map(called.map((one) => [one.id, one.preconditions !== undefined]));
  const unheard = [...heard.values()].filter((said) => !said).length;
  if (unheard === 0) return [];
  if (unheard === heard.size) return ["The record holds no case's preconditions, so the state these cases ran under is unmeasured.", ''];
  return [`${unheard} of ${heard.size} case${heard.size === 1 ? '' : 's'} ${unheard === 1 ? 'was' : 'were'} recorded without preconditions, so the state ${
    unheard === 1 ? 'it' : 'they'
  } ran under is unmeasured.`, ''];
}

/**
 * Every value of a name the cases said, where they said more than one: the
 * conditions the function ran under, which a reader would otherwise ask
 * `covering --where` for. A name said at one value does not split the cases,
 * so it is left to the case lines.
 */
function spanned(called: readonly ReviewCase[]): string {
  const byName = new Map<string, Map<string, NonNullable<ReviewCase['preconditions']>[number]>>();
  for (const held of called.flatMap((one) => one.preconditions ?? [])) {
    // `true` and `'true'` print apart (`flag`, `flag=true`), so they are two values; the text leads so the order is the printed one.
    byName.set(held.name, (byName.get(held.name) ?? new Map()).set(`${String(held.value)}\0${typeof held.value}`, held));
  }
  const said = [...byName]
    .filter(([, values]) => values.size > 1)
    .sort(([left], [right]) => order(left, right))
    .flatMap(([, values]) => [...values].sort(([left], [right]) => order(left, right)).map(([, held]) => escape(valued(held)).replaceAll('|', '\\|')));
  return said.length === 0 ? '' : `; ran under ${said.join(', ')}`;
}

/**
 * Case titles as the tree their file declares: a level for each `describe` a
 * case sits in, under a list item the caller wrote for the file.
 */
export function caseTree(titled: readonly { readonly path: readonly string[]; readonly mark?: string }[]): readonly string[] {
  const out: string[] = [];
  let open: readonly string[] = [];
  for (const { path, mark } of titled) {
    let shared = 0;
    while (shared < open.length && shared < path.length - 1 && open[shared] === path[shared]) shared += 1;
    for (let depth = shared; depth < path.length - 1; depth += 1) out.push(`${'  '.repeat(depth + 1)}- ${path[depth]}`);
    out.push(`${'  '.repeat(path.length)}- ${mark === undefined ? '' : `${mark} `}${path[path.length - 1]}`);
    open = path.slice(0, -1);
  }
  return out;
}

/**
 * The uncovered regions, then every other changed function by its own answer —
 * not the outermost, which is the module's top level whenever that ran. By
 * file and line: the order a reviewer works in.
 */
function located(review: Review): readonly (readonly [string, ReviewRegion])[] {
  return review.files
    .flatMap((file) => [
      ...outermost(file).filter(uncovered),
      ...(file.regions ?? []).filter((region) => region.kind === 'function' && !region.name.includes('/') && !uncovered(region)),
    ].map((region) => [file.file, region] as const))
    .sort(([leftFile, left], [rightFile, right]) => order(leftFile, rightFile) || left.startLine - right.startLine);
}

function lines(region: ReviewRegion): string {
  return region.startLine === region.endLine ? `${region.startLine}` : `${region.startLine}-${region.endLine}`;
}

/** `path:line` or `path:start-end`, and what is there: a branch or loop is named by the function holding it. */
function where(review: Review, file: string, region: ReviewRegion): string {
  const name = region.name === '' ? region.kind : region.kind === 'function' ? `function \`${region.name}\`` : `${region.kind} in \`${region.name}\``;
  return `${place(review, file, region)} ${name}`;
}

/** `path:line` or `path:start-end`, linked to the commit the review read when the host shows it. */
function place(review: Review, file: string, region: ReviewRegion): string {
  const at = `\`${file}:${lines(region)}\``;
  const blob = review.head?.blob;
  if (blob === undefined) return at;
  const anchor = region.startLine === region.endLine ? `L${region.startLine}` : `L${region.startLine}-L${region.endLine}`;
  return `[${at}](${blob}/${file}#${anchor})`;
}

function escape(value: string): string {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;');
}

function order(left: string, right: string): number {
  return left < right ? -1 : left > right ? 1 : 0;
}
