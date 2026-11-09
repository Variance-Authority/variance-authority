// compass: variance-authority.reach.crossings
/**
 * `variance coverage --packages`: the coverage of each package over its own
 * regions, parted by how well its own tests contain it.
 *
 * A package at full coverage can be run entirely by the tests of whatever
 * imports it, and nothing in its own coverage says so. One row per package
 * parts its regions four ways that add up: its own tests ran them from within
 * one import hop, its own tests ran them only from further, only its consumers'
 * tests ran them, or nothing did; then each kind of suite's own tests. The tree
 * under it walks a package down to the files only other packages' tests reach,
 * largest first, so the place a test belongs is the first line read.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { NEAR_HOPS, SUITE_KINDS, type EarnedCount, type EarnedCoverage, type OwnedFile, type SuiteKind } from '@variance-authority/sense/test-selection';
import { grouped, ratio, table } from './coverage-summary.js';
import type { Coverage } from './coverage.js';

/** How many children of one directory the tree names before it counts the rest. */
const NAMED_CHILDREN = 5;
/** How many packages the tree walks before it counts the rest. */
const NAMED_PACKAGES = 5;
/** How many other packages a row names before it counts the rest. */
const NAMED_TESTERS = 3;

type Entries = NonNullable<Coverage['entries']>;

/** A package, a directory or a file, with the regions only other packages' tests ran under it. */
interface Node {
  name: string;
  others: number;
  readonly by: Map<string, number>;
  readonly children: Map<string, Node>;
}

/** One row per package, then the tree of what only other packages' tests ran. */
export function ownershipLines(entries: Entries, ownership: readonly OwnedFile[]): readonly string[] {
  const packages = counted(entries, ownership);
  if (packages.length === 0) return [];
  const ran = packages.filter((row) => row.run > 0);
  const { header, cells } = columns(ownership);
  const lines = [
    "coverage of each package, over its own regions: what its own tests ran within one import hop and further, what only its consumers' tests ran, what nothing ran, and each kind of suite's own tests",
    ...table([['', ...header, 'by'], ...withAll(ran, packages).map((row) => [`  ${row.from}`, ...cells(row), testers(row.by)])]),
  ];
  const before = beforeReach(ran);
  if (before > 0) lines.push(`  ${beforeSentence(before)}`);
  const idle = packages.length - ran.length;
  if (idle > 0) lines.push(`  and ${grouped(idle)} package${idle === 1 ? '' : 's'} no test ran`);
  const { rows, more } = trees(packages, ownership);
  if (rows.length === 0) return lines;
  lines.push("run only by other packages' tests", ...table(rows));
  if (more > 0) lines.push(`  and ${grouped(more)} more packages; --format json lists every file`);
  return lines;
}

/** The same table for a pull request, the tree behind a disclosure of its own. */
export function ownershipMarkdown(entries: Entries, ownership: readonly OwnedFile[]): readonly string[] {
  const packages = counted(entries, ownership);
  const ran = packages.filter((row) => row.run > 0);
  if (ran.length === 0) return [];
  const { header, cells } = columns(ownership);
  const lines = [
    '',
    `<details><summary>📦 Coverage of each of ${grouped(ran.length)} packages</summary>`,
    '',
    'Every share is over the package\'s own regions. A region is its own tests\' when a test in its package ran it, whoever else did, and within one hop when the nearest of them imports its file; consumers only is what only other packages\' tests ran. The kinds count its own tests alone.',
    '',
    `| Package | ${header.join(' | ')} | By |`,
    `|---|${header.map(() => '--:').join('|')}|---|`,
    ...withAll(ran, packages).map((row) =>
      `| \`${row.from}\` | ${cells(row).join(' | ')} | ${testers(row.by, (name) => `\`${name}\``)} |`),
  ];
  const before = beforeReach(ran);
  if (before > 0) lines.push('', `${beforeSentence(before)[0]!.toUpperCase()}${beforeSentence(before).slice(1)}.`);
  const idle = packages.length - ran.length;
  if (idle > 0) lines.push('', `And ${grouped(idle)} package${idle === 1 ? '' : 's'} no test ran.`);
  const { rows, more } = trees(packages, ownership);
  if (rows.length > 0) {
    lines.push('', '```', "run only by other packages' tests", ...table(rows));
    if (more > 0) lines.push(`  and ${grouped(more)} more packages`);
    lines.push('```');
  }
  lines.push('', '</details>');
  return lines;
}

/**
 * Each suite in and out, and every suite joined when there are several. The
 * two are separate coverages of the same regions, so each has its own share.
 */
export function earnedLines(earned: EarnedCoverage | undefined): readonly string[] {
  if (earned === undefined || earned.total.regions === 0) return [];
  const row = (name: string, count: EarnedCount) => [
    `  ${name}`, grouped(count.regions), grouped(count.in), ratio(count.in, count.regions),
    grouped(count.out), ratio(count.out, count.regions), grouped(count.accidental), ratio(count.accidental, count.regions),
  ];
  const lines = [
    "in: its own package's tests within one import hop ran it · out: any other test did · accidental: out, never in",
    ...table([
      ['', 'regions', 'in', '', 'out', '', 'accidental', ''],
      ...earned.suites.map((suite) => row(suite.name ?? 'the record', suite)),
      ...(earned.suites.length > 1 ? [row('any suite', earned.total)] : []),
    ]),
  ];
  if (earned.total.unmeasured > 0) lines.push(`  ${unmeasuredSentence(earned.total.unmeasured)}`);
  return lines;
}

/** The header of the in and out table in a pull request comment. */
export const EARNED_HEADER = [
  "| Suite | Regions | In: its own package's tests, within one import hop | Out: any other test | Accidental: out, never in |",
  '|---|--:|--:|--:|--:|',
] as const;

/** One row per suite of the in and out table, and every suite joined when there are several. */
export function earnedRows(earned: EarnedCoverage | undefined): readonly string[] {
  if (earned === undefined || earned.total.regions === 0) return [];
  const row = (label: string, count: EarnedCount) =>
    `| ${label} | ${grouped(count.regions)} | ${ratio(count.in, count.regions)} | ${ratio(count.out, count.regions)} | ${grouped(count.accidental)} (${ratio(count.accidental, count.regions)}) |`;
  const name = (suite: string) => `\`${suite.replaceAll('|', '\\|')}\``;
  return [...earned.suites.map((suite) => row(name(suite.name ?? 'the record'), suite)), ...(earned.suites.length > 1 ? [row('Any suite', earned.total)] : [])];
}

/** What in and out mean, under the table in a pull request comment. */
export const EARNED_NOTE =
  'In and out are two coverages of the same regions, and both can reach 100%. They rest on an assumption: the farther a test is from the code it ran, the less it is about that code. ' +
  'Whether a test that ran a region checks it is a question for mutation testing.';

/** The regions only tests no walk placed ran. */
function unmeasuredSentence(regions: number): string {
  return `${grouped(regions)} accidental region${regions === 1 ? '' : 's'} ran only under tests at no measured distance`;
}

/** In and out for `coverage --format markdown`, behind its own disclosure. */
export function earnedMarkdown(earned: EarnedCoverage | undefined): readonly string[] {
  const rows = earnedRows(earned);
  if (rows.length === 0) return [];
  return [
    '', '<details><summary>🧭 Coverage in and out: by each package\'s own near tests, and by every other</summary>', '',
    ...EARNED_HEADER, ...rows,
    ...(earned!.total.unmeasured > 0 ? ['', `${unmeasuredSentence(earned!.total.unmeasured)}.`] : []),
    '', EARNED_NOTE, '', '</details>',
  ];
}

interface PackageRow {
  readonly from: string;
  /** The package's own count: its regions, a file no suite loaded among them, and what ran, as the `own` table counts them. */
  readonly regions: number;
  readonly ran: number;
  /** Of `ran`, the regions that ran before reach: in the coverage, and in no part. */
  readonly before: number;
  /** Regions some case called into. */
  readonly run: number;
  readonly own: number;
  readonly others: number;
  readonly by: Map<string, number>;
  /** Per kind of suite, the regions its own tests of that kind ran. */
  readonly kinds: Map<SuiteKind, number>;
  /** The regions the nearest of its own tests that ran them stood within one hop of. */
  readonly near: number;
}

/** Each package the reading listed, summed over the files it owns. */
function counted(entries: Entries, ownership: readonly OwnedFile[]): readonly PackageRow[] {
  if (ownership.length === 0) return [];
  return entries.flatMap((entry) => {
    if ('missed' in entry) return [];
    const files = ownership.filter((file) => file.owner === entry.from);
    return [summed(entry.from, { regions: entry.own.regions, ran: entry.own.ran, before: entry.own.before?.regions ?? 0 }, files.map((file) => ({
      ...file, near: file.near ?? 0,
    })))];
  });
}

/** The rows shown, and when there are several, every package listed added together under `all`, the ones no test ran among them. */
function withAll(rows: readonly PackageRow[], every: readonly PackageRow[]): readonly PackageRow[] {
  if (rows.length < 2) return rows;
  const sum = (field: 'regions' | 'ran' | 'before') => every.reduce((total, row) => total + row[field], 0);
  return [...rows, summed('all', { regions: sum('regions'), ran: sum('ran'), before: sum('before') }, every.map((row) => ({ ...row, by: Object.fromEntries(row.by), kinds: Object.fromEntries(row.kinds) })))];
}

/** What one file, or one package, adds to a row. */
type Part = Pick<OwnedFile, 'run' | 'own' | 'others' | 'by' | 'kinds'> & { readonly near: number };

/** A row over the given own count, its parts added up. */
function summed(from: string, { regions, ran, before }: { readonly regions: number; readonly ran: number; readonly before: number }, parts: readonly Part[]): PackageRow {
  const row = { from, regions, ran, before, run: 0, own: 0, others: 0, by: new Map<string, number>(), kinds: new Map<SuiteKind, number>(), near: 0 };
  for (const part of parts) {
    row.run += part.run;
    row.own += part.own;
    row.others += part.others;
    row.near += part.near;
    add(row.by, part.by);
    add(row.kinds, part.kinds ?? {});
  }
  return row;
}

/** The regions run before reach in the given rows: in the coverage, and in no part. */
function beforeReach(rows: readonly PackageRow[]): number {
  return rows.reduce((sum, row) => sum + row.before, 0);
}

function beforeSentence(regions: number): string {
  return `${grouped(regions)} region${regions === 1 ? '' : 's'} ran before reach: in coverage, in no part`;
}

/**
 * The parts of the coverage, which with what ran at load add up to the package's
 * regions, then one column per kind of suite; each a share of the package's
 * regions. Its own tests are one part when no walk measured a distance.
 */
function columns(ownership: readonly OwnedFile[]): { header: readonly string[]; cells: (row: PackageRow) => readonly string[] } {
  const kinds = SUITE_KINDS.filter((kind) => ownership.some((file) => file.kinds?.[kind] !== undefined));
  const walked = ownership.some((file) => file.near !== undefined);
  return {
    header: ['regions', 'coverage', ...(walked ? [`own ≤${NEAR_HOPS} hop`, 'own further'] : ['own']), 'consumers only', 'nothing', ...kinds],
    cells: (row) => [
      grouped(row.regions), ratio(row.ran, row.regions),
      ...(walked ? [ratio(row.near, row.regions), ratio(row.own - row.near, row.regions)] : [ratio(row.own, row.regions)]),
      ratio(row.others, row.regions), ratio(row.regions - row.ran, row.regions),
      ...kinds.map((kind) => ratio(row.kinds.get(kind) ?? 0, row.regions)),
    ],
  };
}

/** The rows of the packages with the most regions only others' tests ran, each walked down to its files. */
function trees(packages: readonly PackageRow[], ownership: readonly OwnedFile[]): { rows: readonly (readonly string[])[]; more: number } {
  const roots = packages.filter((row) => row.others > 0).map((row) => tree(row.from, ownership)).sort(larger);
  const rows: (readonly string[])[] = [];
  for (const root of roots.slice(0, NAMED_PACKAGES)) walk(root, 1, rows);
  return { rows, more: Math.max(0, roots.length - NAMED_PACKAGES) };
}

/** The package's files only other packages' tests reached, nested by directory. */
function tree(from: string, ownership: readonly OwnedFile[]): Node {
  const root = node(`${from}/`);
  for (const file of ownership) {
    if (file.owner !== from || file.others === 0) continue;
    const parts = (from === '.' ? file.file : file.file.slice(from.length + 1)).split('/');
    let at = root;
    add(at.by, file.by);
    at.others += file.others;
    parts.forEach((part, depth) => {
      const name = depth === parts.length - 1 ? part : `${part}/`;
      let child = at.children.get(name);
      if (child === undefined) at.children.set(name, (child = node(name)));
      child.others += file.others;
      add(child.by, file.by);
      at = child;
    });
  }
  return root;
}

/** Print `at` and its largest children, a directory holding one directory folded into it. */
function walk(at: Node, depth: number, rows: (readonly string[])[]): void {
  while (at.children.size === 1) {
    const [only] = at.children.values();
    if (!only!.name.endsWith('/')) break;
    at = { ...only!, name: `${at.name}${only!.name}` };
  }
  rows.push([`${'  '.repeat(depth)}${at.name}`, grouped(at.others), testers(at.by)]);
  const children = [...at.children.values()].sort(larger);
  for (const child of children.slice(0, NAMED_CHILDREN)) walk(child, depth + 1, rows);
  if (children.length > NAMED_CHILDREN) {
    const rest = children.slice(NAMED_CHILDREN);
    rows.push([`${'  '.repeat(depth + 1)}and ${grouped(rest.length)} more`, grouped(rest.reduce((sum, child) => sum + child.others, 0)), '']);
  }
}

/** The packages whose tests ran the regions, most regions first. */
function testers(by: ReadonlyMap<string, number>, name: (owner: string) => string = (owner) => owner): string {
  const named = [...by].sort(([a, left], [b, right]) => right - left || codeUnitOrder(a, b));
  const said = named.slice(0, NAMED_TESTERS).map(([owner, regions]) => `${name(owner)} ${grouped(regions)}`);
  if (named.length > NAMED_TESTERS) said.push(`and ${grouped(named.length - NAMED_TESTERS)} more`);
  return said.join(' · ');
}

function node(name: string): Node {
  return { name, others: 0, by: new Map(), children: new Map() };
}

function add<Key extends string>(into: Map<Key, number>, counts: Readonly<Partial<Record<Key, number>>>): void {
  for (const [key, regions] of Object.entries(counts) as [Key, number][]) into.set(key, (into.get(key) ?? 0) + regions);
}

function larger(left: Node, right: Node): number {
  return right.others - left.others || codeUnitOrder(left.name, right.name);
}
