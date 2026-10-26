// compass: variance-authority.reach.crossings
/**
 * `variance coverage --packages`, by whose tests ran the code: each package's
 * own, or only other packages'.
 *
 * A package at full coverage can be run entirely by the tests of whatever
 * imports it, and nothing in its own coverage says so. The table puts that
 * share beside each package, and the tree under it walks a package down to the
 * files only other packages' tests reach, largest first, so the place a test
 * belongs is the first line read.
 */

import { codeUnitOrder } from '@variance-authority/core/segment';
import type { OwnedFile } from '@variance-authority/sense/test-selection';
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
  const lines = [
    "which package's tests ran each package",
    ...table([
      ['', 'ran', 'own tests', "only others'", '', 'by'],
      ...ran.map((row) => [`  ${row.from}`, grouped(row.run), ratio(row.own, row.run), grouped(row.others), ratio(row.others, row.run), testers(row.by)]),
    ]),
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
  const lines = [
    '',
    `<details><summary>🧭 How much of each of ${grouped(ran.length)} packages only other packages' tests ran</summary>`,
    '',
    'A region counts as its own when a test in its package ran it, whoever else did.',
    '',
    "| Package | Regions ran | By its own tests | Only by others' | | By |",
    '|---|--:|--:|--:|--:|---|',
    ...ran.map((row) =>
      `| \`${row.from}\` | ${grouped(row.run)} | ${ratio(row.own, row.run)} | ${grouped(row.others)} | ${ratio(row.others, row.run)} | ${testers(row.by, (name) => `\`${name}\``)} |`),
  ];
  const { rows, more } = trees(packages, ownership);
  if (rows.length > 0) {
    lines.push('', '```', "run only by other packages' tests", ...table(rows));
    if (more > 0) lines.push(`  and ${grouped(more)} more packages`);
    lines.push('```');
  }
  lines.push('', '</details>');
  return lines;
}

interface PackageRow {
  readonly from: string;
  readonly run: number;
  readonly own: number;
  readonly others: number;
  readonly by: Map<string, number>;
}

/** Each package the reading listed, summed over the files it owns. */
function counted(entries: Entries, ownership: readonly OwnedFile[]): readonly PackageRow[] {
  if (ownership.length === 0) return [];
  return entries.filter((entry) => !('missed' in entry)).map(({ from }) => {
    const row = { from, run: 0, own: 0, others: 0, by: new Map<string, number>() };
    for (const file of ownership) {
      if (file.owner !== from) continue;
      row.run += file.run;
      row.own += file.own;
      row.others += file.others;
      add(row.by, file.by);
    }
    return row;
  });
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
    const parts = file.file.slice(from.length + 1).split('/');
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

function add(into: Map<string, number>, counts: Readonly<Record<string, number>>): void {
  for (const [owner, regions] of Object.entries(counts)) into.set(owner, (into.get(owner) ?? 0) + regions);
}

function larger(left: Node, right: Node): number {
  return right.others - left.others || codeUnitOrder(left.name, right.name);
}
