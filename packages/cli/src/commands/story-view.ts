/**
 * A route read a part at a time.
 *
 * A long case goes through hundreds of declarations, and a reader about to
 * change one of them needs the part of the route near it, not all of it. So a
 * route is numbered — every stop is a step, in the order the case reached it —
 * and read in three widths: an overview naming each file and the declarations
 * in it with the steps it was there, the windows of the route through one
 * file, and the steps around one step. The step number is the whole of the
 * connection between the parts: the stop before a step is where the case came
 * from. It is not a caller. The tape holds visits, not calls and returns, and a
 * function that returns without entering another region leaves no mark, so a
 * parent drawn from it would nest every sibling under the one before.
 */

import type { Place, Route, Step, Stop } from '@variance-authority/sense/story';

/** One line of a numbered route: a stop with its step, or the head of a loop. */
export interface Line {
  /** Absent on the head of a loop, which is not a stop. */
  readonly step?: number;
  /** How many loops this line is inside. */
  readonly depth: number;
  /** Whether the runner ran it outside the case, just before it. */
  readonly before: boolean;
  readonly stop?: Stop;
  /** On the head of a loop, how many times it went round in all. */
  readonly times?: number;
  /** Indices of the heads of the loops this line is inside, outermost first. */
  readonly heads: readonly number[];
}

/** Steps a window leaves out, so a reader knows what to ask for next. */
export interface Gap {
  readonly gap: readonly [from: number, to: number];
}

/** Number every stop, the steps before the case first. */
export function numbered(route: Route): Line[] {
  const lines: Line[] = [];
  let step = 0;
  const walk = (steps: readonly Step<Stop>[], before: boolean, heads: readonly number[]): void => {
    for (const each of steps) {
      if ('repeat' in each) {
        lines.push({ depth: heads.length, before, times: each.times, heads });
        walk(each.repeat, before, [...heads, lines.length - 1]);
        continue;
      }
      step += 1;
      lines.push({ step, depth: heads.length, before, stop: each.token, heads });
    }
  };
  walk(route.before, true, []);
  walk(route.route, false, []);
  return lines;
}

/** A declaration and the steps the case was there. */
export interface Visit {
  readonly name: string;
  readonly kind: Place['kind'];
  readonly startLine?: number;
  readonly endLine?: number;
  readonly steps: readonly number[];
  /** Whether any of those steps is inside a loop. */
  readonly looped: boolean;
}

/** A file on the route, the step that loaded it, and the declarations visited in it. */
export interface FileVisits {
  readonly file: string;
  readonly loadedAt?: number;
  readonly declarations: readonly Visit[];
}

/** Every file in the order the case first reached it, each declaration in the order it was first visited. */
export function overview(lines: readonly Line[]): FileVisits[] {
  const files = new Map<string, { loadedAt?: number; declarations: Map<string, Visit & { steps: number[] }> }>();
  const fileOf = (file: string) => {
    let found = files.get(file);
    if (found === undefined) files.set(file, found = { declarations: new Map() });
    return found;
  };
  for (const line of lines) {
    if (line.stop === undefined || line.step === undefined) continue;
    if ('loaded' in line.stop) {
      for (const file of line.stop.loaded) fileOf(file).loadedAt ??= line.step;
      continue;
    }
    const { file, name, kind, startLine, endLine } = line.stop.place;
    const declarations = fileOf(file).declarations;
    const key = `${name}\0${startLine}\0${endLine}`;
    const known = declarations.get(key);
    if (known === undefined) {
      declarations.set(key, {
        name, kind, ...(startLine === undefined ? {} : { startLine }), ...(endLine === undefined ? {} : { endLine }),
        steps: [line.step], looped: line.depth > 0,
      });
    } else {
      known.steps.push(line.step);
      if (line.depth > 0) declarations.set(key, { ...known, looped: true });
    }
  }
  return [...files].map(([file, { loadedAt, declarations }]) => ({
    file, ...(loadedAt === undefined ? {} : { loadedAt }), declarations: [...declarations.values()],
  }));
}

/**
 * The lines within `reach` steps of any step `pick` chooses, with the loops
 * they sit in and the gaps between. Each line's `heads` index what is returned.
 */
export function window(lines: readonly Line[], pick: (line: Line) => boolean, reach: number): (Line | Gap)[] {
  const stops = lines.flatMap((line, index) => (line.step === undefined ? [] : [index]));
  const kept = new Set<number>();
  stops.forEach((index, at) => {
    if (!pick(lines[index]!)) return;
    for (let near = Math.max(0, at - reach); near <= Math.min(stops.length - 1, at + reach); near += 1) {
      const line = stops[near]!;
      kept.add(line);
      for (const head of lines[line]!.heads) kept.add(head);
    }
  });
  const shown: (Line | Gap)[] = [];
  // A head is always kept with the lines inside it, so each line's heads are renumbered into what is shown.
  const moved = new Map<number, number>();
  let last = 0;
  for (const index of [...kept].sort((a, b) => a - b)) {
    const line = lines[index]!;
    // A loop's head stands where its first pass begins, so the steps left out
    // before that pass are left out before the head.
    const next = line.step ?? lines[stops.find((stop) => stop > index)!]!.step!;
    if (next > last + 1) shown.push({ gap: [last + 1, next - 1] });
    last = Math.max(last, line.step ?? next - 1);
    moved.set(index, shown.length);
    shown.push({ ...line, heads: line.heads.map((head) => moved.get(head)!) });
  }
  const end = stops.length;
  if (shown.length > 0 && last < end) shown.push({ gap: [last + 1, end] });
  return shown;
}

/** Whether a stop is in the package named `text`, or in a file whose path contains it. */
export function inFile(text: string, packageOf: (file: string) => string | undefined): (line: Line) => boolean {
  const matches = (file: string) => file.includes(text) || packageOf(file) === text;
  return ({ stop }) => stop !== undefined && ('loaded' in stop ? stop.loaded.some(matches) : matches(stop.place.file));
}
