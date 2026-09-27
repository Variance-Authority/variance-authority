/**
 * How much of a route to show, picked from how much there is.
 *
 * A route is read before files are opened, mostly by an agent, and what a
 * reader can use is a page, not a tape. So one part of a route is drawn at up
 * to five levels, each finer than the one before: the packages it went
 * through, the files, the declarations in each file, the steps with other
 * packages passed through, and every step. The reading is the finest level that
 * fits in {@link BUDGET} characters, so a short case is read step by step and a long
 * one opens on its table of contents. A reader who wants finer narrows the part
 * with `--in` or `--around`, which picks again inside it, or asks for every
 * step with `--whole`. The level is named in the reading, with the size of the
 * next one down, so a reader knows what it is not being shown.
 *
 * ## Other packages are passed through
 *
 * A case in an application goes through the workspace's other packages — a
 * design system, a utility library — and a reader changing the application
 * wants to know the route went through them, not every step it took there. So
 * at the level of steps, consecutive steps inside a package that is neither the
 * test's own nor one `--in` named are one line naming the package, its steps
 * and the declarations they were at. A step back in any other package ends the
 * line, so a callback into the application stays on the route. Nothing is
 * dropped: the line names what it holds, and `--in <package>` opens it.
 */

import type { Place } from '@variance-authority/sense/story';
import { overview, type FileVisits, type Gap, type Line } from './story-view.js';

/**
 * Characters a reading is held to before it is drawn one level coarser. A
 * page is counted in characters, not lines, because what a reader pays for is
 * text, and a step drawn with the arms it took is several short lines.
 */
export const BUDGET = 5000;

/** Consecutive steps inside a package the reading passes through. */
export interface Through {
  readonly through: string;
  readonly steps: readonly [from: number, to: number];
  /** The declarations the steps were at, in the order first reached. */
  readonly names: readonly string[];
  readonly depth: number;
  readonly before: boolean;
}

/** A package on the route and the steps the case was in it. */
export interface PackageVisits {
  readonly package: string;
  /** Whether the test itself is in it. */
  readonly own: boolean;
  readonly files: number;
  readonly steps: readonly number[];
}

/** A file on the route, the step that loaded it, and the steps the case was in it; files come grouped by package. */
export interface FileSteps {
  readonly file: string;
  readonly package?: string;
  readonly loadedAt?: number;
  readonly steps: readonly number[];
}

/** One part of a route drawn at one level. */
export type Drawing =
  | { readonly level: 'packages'; readonly packages: readonly PackageVisits[] }
  | { readonly level: 'files'; readonly files: readonly FileSteps[] }
  | { readonly level: 'declarations'; readonly visits: readonly FileVisits[] }
  | { readonly level: 'steps'; readonly lines: readonly (Line | Gap | Through)[]; readonly passed: readonly string[] }
  | { readonly level: 'every step'; readonly lines: readonly (Line | Gap)[] };

export type Level = Drawing['level'];

/**
 * Every level the part `lines` can be drawn at, coarsest first. A level that
 * would say nothing the next one down does not is left out: packages when the
 * part is in one, steps with others passed through when there is nothing to
 * pass through.
 */
export function drawings(
  lines: readonly (Line | Gap)[],
  packageOf: (file: string) => string | undefined,
  open: ReadonlySet<string>,
): Drawing[] {
  const stops = lines.filter((line): line is Line => !('gap' in line) && line.step !== undefined);
  const files = byFile(stops, packageOf);
  const packages = byPackage(files, open);
  const passing = passThrough(lines, packageOf, open);
  const passed = [...new Set(passing.flatMap((line) => ('through' in line ? [line.through] : [])))];
  return [
    ...(packages.length > 1 ? [{ level: 'packages' as const, packages }] : []),
    { level: 'files', files },
    { level: 'declarations', visits: overview(lines) },
    ...(passed.length > 0 ? [{ level: 'steps' as const, lines: passing, passed }] : []),
    { level: 'every step', lines },
  ];
}

/**
 * The finest drawing whose text fits the budget, or the coarsest when none
 * does; the finest, whatever its size, when `whole` asks for every step.
 */
export function pick(sizes: readonly number[], whole: boolean): number {
  if (whole) return sizes.length - 1;
  for (let at = sizes.length - 1; at >= 0; at -= 1) if (sizes[at]! <= BUDGET) return at;
  return 0;
}

function byFile(stops: readonly Line[], packageOf: (file: string) => string | undefined): FileSteps[] {
  const files = new Map<string, { loadedAt?: number; steps: number[] }>();
  const fileOf = (file: string) => {
    let found = files.get(file);
    if (found === undefined) files.set(file, found = { steps: [] });
    return found;
  };
  for (const { stop, step } of stops) {
    if ('loaded' in stop!) for (const file of stop.loaded) fileOf(file).loadedAt ??= step!;
    else fileOf(stop!.place.file).steps.push(step!);
  }
  const drawn = [...files].map(([file, { loadedAt, steps }]): FileSteps => {
    const home = packageOf(file);
    return { file, ...(home === undefined ? {} : { package: home }), ...(loadedAt === undefined ? {} : { loadedAt }), steps };
  });
  // Grouped by package, packages in the order first reached, files in each the same.
  const order = new Map<string | undefined, number>();
  for (const file of drawn) if (!order.has(file.package)) order.set(file.package, order.size);
  return drawn.map((file, at) => ({ file, at })).sort((left, right) =>
    order.get(left.file.package)! - order.get(right.file.package)! || left.at - right.at).map(({ file }) => file);
}

function byPackage(files: readonly FileSteps[], open: ReadonlySet<string>): PackageVisits[] {
  const packages = new Map<string, { files: number; steps: Set<number> }>();
  for (const file of files) {
    if (file.package === undefined) continue;
    let found = packages.get(file.package);
    if (found === undefined) packages.set(file.package, found = { files: 0, steps: new Set() });
    found.files += 1;
    for (const step of file.steps) found.steps.add(step);
    if (file.loadedAt !== undefined) found.steps.add(file.loadedAt);
  }
  return [...packages].map(([name, { files: count, steps }]) => ({
    package: name, own: open.has(name), files: count, steps: [...steps].sort((a, b) => a - b),
  }));
}

/** The lines with each run of steps inside a package nobody opened drawn as one line. */
function passThrough(
  lines: readonly (Line | Gap)[],
  packageOf: (file: string) => string | undefined,
  open: ReadonlySet<string>,
): (Line | Gap | Through)[] {
  const owners = ownersOf(lines, packageOf);
  const out: (Line | Gap | Through)[] = [];
  let at = 0;
  while (at < lines.length) {
    const first = lines[at]!;
    const owner = owners[at];
    if ('gap' in first || owner === undefined || open.has(owner)) {
      out.push(first);
      at += 1;
      continue;
    }
    const steps: number[] = [];
    const names: string[] = [];
    let end = at;
    while (end < lines.length) {
      const next = lines[end]!;
      if ('gap' in next || owners[end] !== owner || next.before !== first.before || next.heads.at(-1) !== first.heads.at(-1)) break;
      // A loop is taken whole: its head, and every line inside it.
      let last = end + 1;
      if (next.step === undefined) while (last < lines.length && inside(lines[last]!, end)) last += 1;
      for (let line = end; line < last; line += 1) {
        const { step, stop } = lines[line] as Line;
        if (step !== undefined) steps.push(step);
        if (stop !== undefined && 'place' in stop) names.push(nameOf(stop.place));
      }
      end = last;
    }
    if (steps.length === 1 && first.step !== undefined) out.push(first);
    else {
      out.push({
        through: owner, steps: [steps[0]!, steps.at(-1)!], names: [...new Set(names)], depth: first.depth, before: first.before,
      });
    }
    at = end;
  }
  return out;
}

/** The package each line is in: a step's own, and a loop's when every step inside it is in one. */
function ownersOf(lines: readonly (Line | Gap)[], packageOf: (file: string) => string | undefined): (string | undefined)[] {
  const owners = lines.map((line) => {
    if ('gap' in line || line.stop === undefined) return undefined;
    if ('place' in line.stop) return packageOf(line.stop.place.file);
    const homes = new Set(line.stop.loaded.map(packageOf));
    return homes.size === 1 ? [...homes][0] : undefined;
  });
  // Inner loops first, so an outer loop reads its inner heads' answers.
  for (let head = lines.length - 1; head >= 0; head -= 1) {
    const line = lines[head]!;
    if ('gap' in line || line.step !== undefined) continue;
    let owner: string | undefined;
    let one = true;
    let body = head + 1;
    for (; body < lines.length && inside(lines[body]!, head); body += 1) {
      const next = lines[body] as Line;
      if (next.heads.at(-1) !== head) continue;
      if (owners[body] === undefined || (owner !== undefined && owners[body] !== owner)) one = false;
      owner ??= owners[body];
    }
    // A loop cut short by a gap is not known to be in one package.
    owners[head] = one && (body === lines.length || !('gap' in lines[body]!)) ? owner : undefined;
  }
  return owners;
}

function inside(line: Line | Gap, head: number): boolean {
  return !('gap' in line) && line.heads.includes(head);
}

function nameOf(place: Place): string {
  return place.name === '' ? `${place.file.slice(place.file.lastIndexOf('/') + 1)} (top level)` : place.name;
}
