// compass: variance-authority/runtime/attention
/**
 * Where a change lands, a package at a time: the changed functions in each
 * package, how near the tests that ran them were, the packages those tests
 * live in, and how many packages import the changed code.
 *
 * A monorepo pull request is read package by package — by whoever owns each
 * one — and a list of functions does not say which owner to ask, nor whether a
 * package's own tests ran its change or another package's happened to. The
 * manifest is the package boundary, as everywhere else here.
 *
 * The table is bounded whatever the repository's size: the packages with code
 * no nearby test ran come first, and once there are more packages than rows,
 * the ones whose every function a nearby test ran are folded into one row, and
 * the rest past the budget into another, both counted in it. The JSON keeps
 * every package.
 */

import { relative, resolve } from 'node:path';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { packageName, packageOf } from '../package-home.js';
import { functionOf, located, uncovered } from './review-scope.js';
import { REACHES, type Reach, type ReviewArea, type ReviewFile } from './review.js';

export type { ReviewArea } from './review.js';

/** Packages given a row before the rest are folded. */
const ROWS = 10;
/** Packages named in a row's tests before the rest are counted. */
const TESTED_FROM = 3;

/**
 * Each package holding a changed function, by its directory. `dependents`
 * answers which files depend on a set of changed files, the changed files
 * included: the review passes the import graph's walk.
 */
export function areasOf(
  root: string,
  files: readonly ReviewFile[],
  dependents: (changed: readonly string[]) => readonly string[],
): readonly ReviewArea[] {
  const top = resolve(root);
  const names = new Map<string, string>();
  const homes = new Map<string, string>();
  // One walk a package names the same importers again and again: a file's package is looked up once.
  const homeOf = (file: string): string => {
    let home = homes.get(file);
    if (home === undefined) homes.set(file, (home = packageOf(top, file) ?? top));
    return home;
  };
  const nameOf = (home: string): string => {
    let name = names.get(home);
    if (name === undefined) names.set(home, (name = packageName(top, home)));
    return name;
  };

  const held = new Map<string, { readonly functions: Map<string, Reach>; readonly tests: Set<string>; readonly changed: string[] }>();
  const entry = (home: string) => {
    let at = held.get(home);
    if (at === undefined) held.set(home, (at = { functions: new Map(), tests: new Set(), changed: [] }));
    return at;
  };
  for (const file of files) entry(homeOf(file.file)).changed.push(file.file);
  for (const [file, region] of located({ files })) {
    const { functions, tests } = entry(homeOf(file));
    const key = `${file}\0${functionOf(region)}`;
    const prior = functions.get(key);
    // A function's answer is its worst region's: a branch no case ran leaves the function uncovered.
    if (prior === undefined || REACHES.indexOf(region.reach) > REACHES.indexOf(prior)) functions.set(key, region.reach);
    for (const test of region.tests) tests.add(nameOf(homeOf(test)));
  }

  return [...held]
    .filter(([, { functions }]) => functions.size > 0)
    .map(([home, { functions, tests, changed }]): ReviewArea => {
      const reaches: Partial<Record<Reach, number>> = {};
      for (const reach of functions.values()) reaches[reach] = (reaches[reach] ?? 0) + 1;
      const importers = new Set<string>();
      for (const file of dependents(changed)) {
        const at = homeOf(file);
        if (at !== home) importers.add(at);
      }
      return {
        package: nameOf(home),
        path: relative(top, home) || '.',
        functions: functions.size,
        reaches: Object.fromEntries(REACHES.filter((reach) => reaches[reach] !== undefined).map((reach) => [reach, reaches[reach]])),
        tests: [...tests].sort(codeUnitOrder),
        importers: importers.size,
      };
    })
    .sort((left, right) => codeUnitOrder(left.path, right.path));
}

/**
 * The packages as a table for a comment, when the change lands in more than
 * one: the ones with gaps first, at most `ROWS` of them, and the rest folded.
 */
export function areasMarkdown(areas: readonly ReviewArea[] | undefined, mark: (reach: Reach) => string): readonly string[] {
  if (areas === undefined || areas.length < 2) return [];
  const total = areas.reduce((sum, area) => sum + area.functions, 0);
  const ranked = [...areas].sort((left, right) =>
    unrun(right) - unrun(left) || away(right) - away(left) || right.functions - left.functions || codeUnitOrder(left.package, right.package));
  const lines = [
    '',
    `**Where this change lands:** ${total} changed function${total === 1 ? '' : 's'} in ${areas.length} packages.`,
    '',
    '| Package | Changed functions | Ran | Tests from | Packages importing it |',
    '|---|--:|---|---|--:|',
  ];
  const row = (area: ReviewArea): string =>
    `| \`${area.package}\` | ${area.functions} | ${tally(area.reaches, mark)} | ${testedFrom(area)} | ${area.importers} |`;
  if (ranked.length <= ROWS) return [...lines, ...ranked.map(row)];

  const gaps = ranked.filter((area) => away(area) > 0);
  const quiet = ranked.filter((area) => away(area) === 0);
  // The fold rows are rows too: the quiet one when there is any, the overflow one when the gaps do not fit beside it.
  const room = ROWS - (quiet.length > 0 ? 1 : 0);
  const shown = gaps.length <= room ? gaps.length : room - 1;
  lines.push(...gaps.slice(0, shown).map(row));
  if (shown < gaps.length) lines.push(folded(gaps.slice(shown), packages(gaps.length - shown, true), mark));
  if (quiet.length > 0) lines.push(folded(quiet, `${packages(quiet.length, shown > 0)}, every function ${mark('near')}`, mark));
  return [...lines, '', 'Each package is in the review\'s JSON, under `areas`.'];
}

/** Several packages on one row: their functions and marks summed. Their importers are left blank, since a sum would count a package importing two of them twice. */
function folded(areas: readonly ReviewArea[], label: string, mark: (reach: Reach) => string): string {
  const reaches: Partial<Record<Reach, number>> = {};
  for (const area of areas) for (const reach of REACHES) reaches[reach] = (reaches[reach] ?? 0) + (area.reaches[reach] ?? 0);
  const functions = areas.reduce((sum, area) => sum + area.functions, 0);
  return `| ${label} | ${functions} | ${tally(reaches, mark)} | | |`;
}

/** The functions by mark, in the marks' order: the reaches one mark stands for are summed under it. */
function tally(reaches: ReviewArea['reaches'], mark: (reach: Reach) => string): string {
  const byMark = new Map<string, number>();
  for (const reach of REACHES) {
    const count = reaches[reach] ?? 0;
    if (count > 0) byMark.set(mark(reach), (byMark.get(mark(reach)) ?? 0) + count);
  }
  return [...byMark].map(([sign, count]) => `${sign} ${count}`).join(' · ');
}

/** The package's own tests first, as `own`, then the other packages whose tests entered it. */
function testedFrom(area: ReviewArea): string {
  const others = area.tests.filter((name) => name !== area.package);
  const named = [...(others.length < area.tests.length ? ['own'] : []), ...others.slice(0, TESTED_FROM).map((name) => `\`${name}\``)];
  if (named.length === 0) return 'none';
  return others.length > TESTED_FROM ? `${named.join(', ')} and ${others.length - TESTED_FROM} more` : named.join(', ');
}

/** Functions holding code no case ran. */
function unrun(area: ReviewArea): number {
  return REACHES.filter((reach) => uncovered({ reach })).reduce((sum, reach) => sum + (area.reaches[reach] ?? 0), 0);
}

/** Functions no test importing their file ran. */
function away(area: ReviewArea): number {
  return area.functions - (area.reaches.near ?? 0);
}

function packages(count: number, more: boolean): string {
  return `${count}${more ? ' more' : ''} package${count === 1 ? '' : 's'}`;
}
