/**
 * Two sets of readings of one case, compared: what one side does every time and
 * the other never does.
 *
 * A journey is a set because the order async work finishes in changes from one
 * run to the next, and a set that moved every run would say nothing. A story
 * keeps the order, so it inherits the same noise: two readings of a case that
 * passed both times already differ in where their promises resolved. A
 * difference between two readings is therefore no answer by itself. It becomes
 * one when it holds on every reading of one side and on none of the other —
 * every failing run took the `else`, every passing one the `then`; every
 * failing run heard the response before the click, every passing one after.
 *
 * So a side is a set of readings, and three things are compared:
 *
 * - **Where.** A region every reading of one side went into and no reading of
 *   the other did: an arm, a loop body, a function.
 * - **What was said.** A note — a console line, an announcement, what Eyes
 *   saw — that every reading of one side has and none of the other.
 * - **In what order.** Two places, or two notes, both sides reach every time,
 *   that one side reaches in one order every time and the other in the other
 *   order every time. Order is compared at first arrival, at the grain of a
 *   declaration or a note, which is the grain a person reads a route at.
 *
 * Everything that differs and does not hold within a side is counted as
 * **unsteady** and left out: it is the interleaving that makes order useless
 * for a journey, and it is what a flake looks like before it is separated from
 * the thing that decides it. With one reading on a side nothing can be told
 * apart from noise, and the comparison says so rather than guess.
 */

import { readFileSync } from 'node:fs';
import { declarationsOf, inCheckout, regionsOfStory, type Place, type Region, type StoryEntry } from './read.js';
import stories from './format.cjs';

/** The readings one side of a comparison is made of, and what to call it. */
export interface Side {
  readonly name: string;
  readonly readings: readonly StoryEntry[];
}

/** A region one side went into every time and the other never did. */
export interface PlaceDifference {
  readonly place: Place;
  /** Where in the declaration: `entry` for the declaration itself, `if#0/else` for an arm. */
  readonly path: string;
  readonly startLine?: number;
  readonly endLine?: number;
  /**
   * For an arm of an `if`, the line the `if` is named by: where its `then`
   * starts. An `if` written with no `else` is given one on the line it ends,
   * so the `else`'s own start names a different line from its `then`'s.
   */
  readonly constructLine?: number;
}

/** Something a comparison orders: a declaration's first arrival, a module loading, or a line said. */
export type Moment =
  | { readonly place: Place }
  | { readonly loaded: string }
  | { readonly said: string };

/** One side's difference: what only it has, first in the order its newest reading reached them. */
export interface OnlyIn<T> {
  readonly side: string;
  readonly items: readonly T[];
}

/**
 * Two sides of one case's readings, set against each other: what each side did
 * on every reading and the other on none, the orders the sides hold opposite,
 * and a count of what moves within a side as well.
 */
export interface Comparison {
  readonly file: string;
  readonly name: string;
  readonly sides: readonly [SideSummary, SideSummary];
  /** Regions one side went into every time and the other never. */
  readonly places: readonly [OnlyIn<PlaceDifference>, OnlyIn<PlaceDifference>];
  /** Lines one side said every time and the other never. */
  readonly said: readonly [OnlyIn<string>, OnlyIn<string>];
  /**
   * Pairs both sides reach every time, first-side order first: the first side
   * reaches `[0]` before `[1]` on every reading, the second side after it on
   * every reading. First in the order the first side's newest reading reached
   * the earlier of the two.
   */
  readonly reversed: readonly (readonly [Moment, Moment])[];
  /** What differs between readings of one side as well: counted, never listed. */
  readonly unsteady: { readonly places: number; readonly said: number; readonly order: number };
  /** Whether a side holds one reading, so no difference can be told from a run that just went another way. */
  readonly single: boolean;
}

export interface SideSummary {
  readonly name: string;
  readonly readings: number;
  /** How many of them threw or rejected. */
  readonly stopped: number;
}

/** What one reading is, reduced to what a comparison asks of it. */
interface Read {
  /** Every region it went into, by key. */
  readonly regions: Set<string>;
  /** Every line it said, by text. */
  readonly said: Set<string>;
  /** Each moment's first arrival, by key, in order. */
  readonly first: Map<string, number>;
}

/** A reading decoded, with each of its modules' regions where the record beside it holds them. */
export interface Loaded {
  readonly story: ReturnType<typeof stories.decodeStory>;
  readonly files: readonly string[];
  readonly regions: readonly (readonly Region[] | undefined)[];
}

/** Compare side `a` with side `b`; both are readings of one case. */
export function compareReadings(root: string, a: Side, b: Side): Comparison {
  const load = (entry: StoryEntry): Loaded => {
    const story = stories.decodeStory(readFileSync(entry.path));
    return { story, ...regionsOfStory(entry.path, story) };
  };
  return compareLoaded(
    root,
    { name: a.name, readings: a.readings.map(load) },
    { name: b.name, readings: b.readings.map(load) },
  );
}

/** {@link compareReadings} over readings already read. */
export function compareLoaded(
  root: string,
  a: { readonly name: string; readonly readings: readonly Loaded[] },
  b: { readonly name: string; readonly readings: readonly Loaded[] },
): Comparison {
  const names = new Map<string, PlaceDifference>();
  const moments = new Map<string, Moment>();
  const readOf = (loaded: Loaded): Read => readReading(root, loaded, names, moments);
  const left = a.readings.map(readOf);
  const right = b.readings.map(readOf);
  const case_ = (a.readings[0] ?? b.readings[0])?.story;

  const places = steady(left, right, (read) => read.regions);
  const said = steady(left, right, (read) => read.said);
  const byArrival = (reads: readonly Read[], prefix: string) => (key: string): number =>
    reads[0]?.first.get(`${prefix}${key}`) ?? Infinity;
  const order = reversedPairs(left, right);

  return {
    file: case_ === undefined ? '' : inCheckout(root, case_.file),
    name: case_?.name ?? '',
    sides: [summary(a), summary(b)],
    places: [
      { side: a.name, items: arrived(places.onlyLeft, byArrival(left, 'r')).map((key) => names.get(key)!) },
      { side: b.name, items: arrived(places.onlyRight, byArrival(right, 'r')).map((key) => names.get(key)!) },
    ],
    said: [
      { side: a.name, items: arrived(said.onlyLeft, byArrival(left, 's')) },
      { side: b.name, items: arrived(said.onlyRight, byArrival(right, 's')) },
    ],
    reversed: order.reversed.map(([first, then]) => [moments.get(first)!, moments.get(then)!] as const),
    unsteady: { places: places.unsteady, said: said.unsteady, order: order.unsteady },
    single: left.length < 2 || right.length < 2,
  };
}

function summary(side: { readonly name: string; readonly readings: readonly Loaded[] }): SideSummary {
  return { name: side.name, readings: side.readings.length, stopped: side.readings.filter((loaded) => loaded.story.stopped === true).length };
}

/**
 * One reading's regions, lines and first arrivals. Region keys carry the
 * module's region count beside its file, so two texts of one file never meet.
 */
function readReading(root: string, { story, files, regions }: Loaded, names: Map<string, PlaceDifference>, moments: Map<string, Moment>): Read {
  const shown = files.map((file) => inCheckout(root, file));
  const declarations = regions.map((own, row) => (own === undefined ? undefined : declarationsOf(shown[row]!, own)));
  const bases: number[] = [];
  let total = 0;
  for (const [, count] of story.rows) {
    bases.push(total);
    total += count;
  }
  const read: Read = { regions: new Set(), said: new Set(), first: new Map() };
  let clock = 0;
  const arrive = (key: string, moment: Moment): void => {
    if (!moments.has(key)) moments.set(key, moment);
    if (!read.first.has(key)) read.first.set(key, clock);
    clock += 1;
  };
  const hear = (text: string): void => {
    read.said.add(text);
    if (!read.first.has(`s${text}`)) read.first.set(`s${text}`, clock);
    arrive(`m\0said\0${text}`, { said: text });
  };
  const walk = (visits: Int32Array, notes: readonly (readonly [number, string])[]): void => {
    let note = 0;
    for (let at = 0; at <= visits.length; at += 1) {
      for (; note < notes.length && notes[note]![0] <= at; note += 1) hear(notes[note]![1]);
      if (at === visits.length) break;
      const visit = visits[at]!;
      const index = visit & 0x7fffffff;
      let row = bases.length - 1;
      while (bases[row]! > index) row -= 1;
      const ordinal = index - bases[row]!;
      const file = shown[row]!;
      const key = `${file}\0${story.rows[row]![1]}\0${ordinal}`;
      const own = regions[row]?.[ordinal];
      const place: Place = own === undefined
        ? { file, name: '', kind: 'module' }
        : declarations[row]!.get(own.name)!;
      if (!names.has(key)) {
        const construct = own === undefined ? undefined : ifLine(own, regions[row]!);
        names.set(key, {
          place,
          path: own?.path ?? `region ${ordinal}`,
          ...(own?.startLine === undefined ? {} : { startLine: own.startLine, endLine: own.endLine }),
          ...(construct === undefined ? {} : { constructLine: construct }),
        });
      }
      read.regions.add(key);
      if (!read.first.has(`r${key}`)) read.first.set(`r${key}`, clock);
      if (visit & stories.EVALUATING) arrive(`m\0loaded\0${file}`, { loaded: file });
      else arrive(`m\0${place.file}\0${place.name}`, { place });
    }
  };
  walk(story.before, story.beforeNotes);
  walk(story.visits, story.notes);
  return read;
}

/** Where the `then` of the `if` an arm belongs to starts, from the module's regions; nothing for any other region. */
function ifLine(arm: Region, regions: readonly Region[]): number | undefined {
  const parts = arm.path.split('/');
  const [construct, label] = parts.slice(-2);
  if (!construct?.startsWith('if#') || (label !== 'then' && label !== 'else')) return undefined;
  const then = [...parts.slice(0, -1), 'then'].join('/');
  return regions.find((region) => region.name === arm.name && region.path === then)?.startLine;
}

/** What every reading on one side has and no reading on the other, and how many things differ within a side. */
function steady(
  left: readonly Read[],
  right: readonly Read[],
  of: (read: Read) => ReadonlySet<string>,
): { onlyLeft: string[]; onlyRight: string[]; unsteady: number } {
  const everywhere = (reads: readonly Read[]): Set<string> => {
    const sets = reads.map(of);
    return new Set([...(sets[0] ?? [])].filter((key) => sets.every((set) => set.has(key))));
  };
  const anywhere = (reads: readonly Read[]): Set<string> => new Set(reads.flatMap((read) => [...of(read)]));
  const [allLeft, allRight, anyLeft, anyRight] = [everywhere(left), everywhere(right), anywhere(left), anywhere(right)];
  const onlyLeft = [...allLeft].filter((key) => !anyRight.has(key));
  const onlyRight = [...allRight].filter((key) => !anyLeft.has(key));
  let unsteady = 0;
  for (const key of new Set([...anyLeft, ...anyRight])) {
    const shared = allLeft.has(key) && allRight.has(key);
    const split = onlyLeft.includes(key) || onlyRight.includes(key);
    if (!shared && !split) unsteady += 1;
  }
  return { onlyLeft, onlyRight, unsteady };
}

/** Keys in the order `arrival` puts them, a key with no arrival last, ties by code unit. */
function arrived(keys: readonly string[], arrival: (key: string) => number): string[] {
  return [...keys].sort((left, right) => arrival(left) - arrival(right) || (left < right ? -1 : left > right ? 1 : 0));
}

/**
 * Pairs of moments every reading reaches, ordered one way on every reading of
 * the left side and the other way on every reading of the right; and how many
 * pairs changed order between readings of one side.
 */
function reversedPairs(left: readonly Read[], right: readonly Read[]): { reversed: [string, string][]; unsteady: number } {
  const all = [...left, ...right];
  const moments = [...(all[0]?.first.keys() ?? [])].filter((key) => key.startsWith('m\0') && all.every((read) => read.first.has(key)));
  const lead = left[0] ?? right[0];
  // In the order the left side's newest reading reached them, so each pair is
  // read earlier-first on the left.
  moments.sort((one, two) => lead!.first.get(one)! - lead!.first.get(two)!);
  const reversed: [string, string][] = [];
  let unsteady = 0;
  const sign = (read: Read, one: string, two: string): number => Math.sign(read.first.get(one)! - read.first.get(two)!);
  const held = (reads: readonly Read[], one: string, two: string): number | undefined => {
    const first = sign(reads[0]!, one, two);
    return reads.every((read) => sign(read, one, two) === first) ? first : undefined;
  };
  for (let at = 0; at < moments.length; at += 1) {
    for (let next = at + 1; next < moments.length; next += 1) {
      const one = moments[at]!;
      const two = moments[next]!;
      const onLeft = held(left, one, two);
      const onRight = held(right, one, two);
      if (onLeft === undefined || onRight === undefined) unsteady += 1;
      else if (onLeft === -onRight && onLeft !== 0) reversed.push(onLeft < 0 ? [one, two] : [two, one]);
    }
  }
  return { reversed, unsteady };
}
