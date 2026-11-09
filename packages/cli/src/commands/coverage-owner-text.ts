// compass: variance-authority.reach.crossings
/**
 * `variance coverage --packages`: the coverage of each package over its own
 * regions, parted the ways one total hides.
 *
 * A package at full coverage can be run entirely by the tests of whatever
 * imports it, and nothing in its own coverage says so. One row per package puts
 * beside its coverage the share its own tests ran, each kind of suite's, how
 * near the nearest test stood, and what only other packages' tests ran; the
 * tree under it walks a package down to the files only other packages' tests
 * reach, largest first, so the place a test belongs is the first line read.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import { SUITE_KINDS, type EarnedCount, type EarnedCoverage, type OwnedFile, type SuiteKind } from '@variance-authority/sense/test-selection';
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

/** The import hops each distance column counts within. */
const HOPS = [1, 2, 3] as const;

/** One row per package, then the tree of what only other packages' tests ran. */
export function ownershipLines(entries: Entries, ownership: readonly OwnedFile[]): readonly string[] {
  const packages = counted(entries, ownership);
  if (packages.length === 0) return [];
  const ran = packages.filter((row) => row.run > 0);
  const { header, cells } = columns(ownership);
  const lines = [
    "coverage of each package, over its own regions: by any test, its own, each kind of suite, the nearest test, and only other packages'",
    ...table([['', ...header, "only others'", '', 'by'], ...ran.map((row) => [`  ${row.from}`, ...cells(row), grouped(row.others), ratio(row.others, row.regions), testers(row.by)])]),
  ];
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
    'Every share is over the package\'s own regions. A region is its own tests\' when a test in its package ran it, whoever else did; a distance counts it under the nearest test that ran it, in any suite.',
    '',
    `| Package | ${header.join(' | ')} | Only others' | | By |`,
    `|---|${header.map(() => '--:').join('|')}|--:|--:|---|`,
    ...ran.map((row) =>
      `| \`${row.from}\` | ${[...cells(row), grouped(row.others), ratio(row.others, row.regions)].join(' | ')} | ${testers(row.by, (name) => `\`${name}\``)} |`),
  ];
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
  /** Regions some case called into. */
  readonly run: number;
  readonly own: number;
  readonly others: number;
  readonly by: Map<string, number>;
  readonly kinds: Map<SuiteKind, number>;
  /** Per hop band, the regions whose nearest test stood within it. */
  readonly within: number[];
}

/** Each package the reading listed, summed over the files it owns. */
function counted(entries: Entries, ownership: readonly OwnedFile[]): readonly PackageRow[] {
  if (ownership.length === 0) return [];
  return entries.flatMap((entry) => {
    if ('missed' in entry) return [];
    const row = { from: entry.from, regions: entry.own.regions, ran: entry.own.ran, run: 0, own: 0, others: 0, by: new Map<string, number>(), kinds: new Map<SuiteKind, number>(), within: HOPS.map(() => 0) };
    for (const file of ownership) {
      if (file.owner !== entry.from) continue;
      row.run += file.run;
      row.own += file.own;
      row.others += file.others;
      add(row.by, file.by);
      add(row.kinds, file.kinds);
      for (const [hop, count] of Object.entries(file.nearest ?? {})) HOPS.forEach((most, at) => (row.within[at]! += Number(hop) <= most ? count : 0));
    }
    return [row];
  });
}

/** The columns every suite kind and, when the hops were walked, every hop band adds, each a share of the package's regions. */
function columns(ownership: readonly OwnedFile[]): { header: readonly string[]; cells: (row: PackageRow) => readonly string[] } {
  const kinds = SUITE_KINDS.filter((kind) => ownership.some((file) => file.kinds[kind] !== undefined));
  const walked = ownership.some((file) => file.nearest !== undefined);
  return {
    header: ['regions', 'coverage', 'own tests', ...kinds, ...(walked ? HOPS.map((hop) => `≤${hop} hop${hop === 1 ? '' : 's'}`) : [])],
    cells: (row) => [
      grouped(row.regions), ratio(row.ran, row.regions), ratio(row.own, row.regions),
      ...kinds.map((kind) => ratio(row.kinds.get(kind) ?? 0, row.regions)), ...(walked ? row.within.map((count) => ratio(count, row.regions)) : []),
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
