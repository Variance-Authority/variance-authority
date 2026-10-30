/**
 * Sets of readings compared: what some sides do every time and the rest never do.
 *
 * A journey is a set because the order async work finishes in changes from one
 * run to the next, and a set that moved every run would say nothing. A story
 * keeps the order, so it inherits the same noise: two readings of a case that
 * passed both times already differ in where their promises resolved. A
 * difference between two readings is therefore no answer by itself. It becomes
 * one when it holds on every reading of some sides and on none of the rest —
 * every failing run took the `else`, every passing one the `then`; every
 * failing run heard the response before the click, every passing one after.
 *
 * So a side is a set of readings — one case's runs that passed, the runs under
 * one label, or one case of several — and there are two sides or more. Three
 * things are compared:
 *
 * - **Where.** A region every reading of some sides went into and no reading of
 *   the rest did: an arm, a loop body, a function.
 * - **What was said.** A note — a console line, an announcement, what Eyes
 *   saw — that every reading of some sides has and none of the rest.
 * - **In what order.** Two places, or two notes, every side reaches every time,
 *   that each side reaches in one order every time, and not every side in the
 *   same one, compared at first arrival, at the grain a person reads a route
 *   at: a declaration or a note.
 *
 * Each difference is told under the sides that hold it, so with three sides an
 * arm both failing cases took and the passing one did not is one finding, not
 * two comparisons a reader has to lay over each other.
 *
 * Everything that differs and does not hold within a side is counted as
 * **unsteady** and left out: it is the interleaving that makes order useless
 * for a journey, and it is what a flake looks like before it is separated from
 * the thing that decides it. With one reading on a side nothing can be told
 * apart from noise, and the comparison says so rather than guess.
 */

import { readFileSync } from 'node:fs';
import { inCheckout, placesOf, regionsOfStory, type Place, type Region, type StoryEntry } from './read.js';
import stories from './format.cjs';

/** The readings one side of a comparison is made of, and what to call it. */
export interface Side {
  readonly name: string;
  readonly readings: readonly StoryEntry[];
}

/** A region some sides went into every time and the rest never did. */
export interface PlaceDifference {
  readonly place: Place;
  /** Where in the declaration: `entry` for the declaration itself, `if#0/else` for an arm. */
  readonly path: string;
  /** The region's coordinate, `src/price.js#lineTotal/if#0/else`; absent where the record does not hold the module's regions. */
  readonly at?: string;
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

/**
 * What the sides named hold on every reading and the other sides on none, each
 * first in the order the newest reading of the first of those sides reached it.
 */
export interface Only {
  /** The sides that hold it, in the order the comparison was given them. */
  readonly sides: readonly string[];
  /** Regions they went into. */
  readonly places: readonly PlaceDifference[];
  /** Lines they said. */
  readonly said: readonly string[];
}

/**
 * Two moments every reading reaches, in an order each side holds on every
 * reading: `before` reaches `pair[0]` first, `after` reaches it second.
 */
export interface Order {
  readonly pair: readonly [Moment, Moment];
  /** The sides that reach `pair[0]` first; the first side is always one of them. */
  readonly before: readonly string[];
  readonly after: readonly string[];
}

/**
 * Sides of readings set against each other: what some sides did on every
 * reading and the rest on none, the orders the sides hold differently, and a
 * count of what moves within a side as well.
 */
export interface Comparison {
  /** The case the first side's newest reading is of. */
  readonly file: string;
  readonly name: string;
  readonly sides: readonly SideSummary[];
  /** What separates the sides, one entry for each set of sides that holds something, in the order of the sides. */
  readonly only: readonly Only[];
  /** Orders the sides hold differently, first in the order the first side's newest reading reached the earlier of the two. */
  readonly orders: readonly Order[];
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
  /** Every line it said, by text and how many times: `text\0count`. */
  readonly said: Set<string>;
  /** Each moment's first arrival, by key, in order. */
  readonly first: Map<string, number>;
  /**
   * For a reading of a case that ran in pages, the frame each moment first
   * arrived in and the test line it arrived under, by key.
   */
  readonly realms?: Map<string, readonly [frame: number, line: number]>;
}

/** A reading decoded, with each of its modules' regions where the record beside it holds them. */
export interface Loaded {
  readonly story: ReturnType<typeof stories.decodeStory>;
  readonly files: readonly string[];
  readonly regions: readonly (readonly Region[] | undefined)[];
}

/** Compare two sides or more, in the order given; the first side's case names the comparison. */
export function compareReadings(root: string, sides: readonly Side[]): Comparison {
  const load = (entry: StoryEntry): Loaded => {
    const story = stories.decodeStory(readFileSync(entry.path));
    return { story, ...regionsOfStory(entry.path, story) };
  };
  return compareLoaded(root, sides.map((side) => ({ name: side.name, readings: side.readings.map(load) })));
}

/** One side of {@link compareLoaded}: readings already read. */
export interface LoadedSide {
  readonly name: string;
  readonly readings: readonly Loaded[];
}

/** {@link compareReadings} over readings already read. */
export function compareLoaded(root: string, sides: readonly LoadedSide[]): Comparison {
  const names = new Map<string, PlaceDifference>();
  const moments = new Map<string, Moment>();
  // What ran before a case is a difference between readings of one case, and
  // between different cases only their places in the file.
  const cases = new Set(sides.flatMap((side) => side.readings.map(({ story }) => `${story.file}\0${story.name}`)));
  const reads = sides.map((side) => side.readings.map((loaded) => readReading(root, loaded, names, moments, cases.size === 1)));
  const case_ = sides.flatMap((side) => side.readings)[0]?.story;

  const places = steady(reads, (read) => read.regions);
  const said = steady(reads, (read) => read.said);
  const order = orderedPairs(reads);
  const groups = [...new Set([...places.held.keys(), ...said.held.keys()])].sort(bySides);
  const named = (positions: readonly number[]): string[] => positions.map((at) => sides[at]!.name);

  return {
    file: case_ === undefined ? '' : inCheckout(root, case_.file),
    name: case_?.name ?? '',
    sides: sides.map(summary),
    only: groups.map((group) => ({
      sides: named(group.split(',').map(Number)),
      places: (places.held.get(group) ?? []).map((key) => names.get(key)!),
      said: (said.held.get(group) ?? []).map(shownSaid),
    })),
    orders: order.differing.map(({ pair: [first, then], before }) => ({
      pair: [moments.get(first)!, moments.get(then)!] as const,
      before: named(before),
      after: named(sides.map((_, at) => at).filter((at) => !before.includes(at))),
    })),
    unsteady: { places: places.unsteady, said: said.unsteady, order: order.unsteady },
    single: reads.some((side) => side.length < 2),
  };
}

/** Sets of sides, written as their positions joined by commas, by their first side, then their next. */
function bySides(one: string, two: string): number {
  const [left, right] = [one.split(',').map(Number), two.split(',').map(Number)];
  for (let at = 0; at < Math.min(left.length, right.length); at += 1) {
    if (left[at] !== right[at]) return left[at]! - right[at]!;
  }
  return left.length - right.length;
}

function summary(side: LoadedSide): SideSummary {
  return { name: side.name, readings: side.readings.length, stopped: side.readings.filter((loaded) => loaded.story.stopped === true).length };
}

// A ref numbers objects in the order a run met them, so across runs a value
// the tap showed — handed, held, or in a note — compares by its kind alone. A
// ref is a word of its own, then the kind or a cut; a console line spelled
// alike compares the same.
const REF = /(?<=^|[\s=])ref\d+(?=[\s…]|$)/gu;

/** The text a said key holds, without the times it was said. */
function textOf(key: string): string {
  return key.slice(0, key.lastIndexOf('\0'));
}

/** A said key as a person reads it: the text, and `×n` where it was said more than once, so a line said twice on one side and once on the other is told apart. */
function shownSaid(key: string): string {
  const times = key.slice(key.lastIndexOf('\0') + 1);
  return times === '1' ? textOf(key) : `${textOf(key)} ×${times}`;
}

/** What a line said means in another run: each object's ref without its number. */
function acrossRuns(said: string): string {
  return said.replace(REF, 'ref');
}

/**
 * One reading's regions, lines and first arrivals. A region is keyed by its
 * coordinate, so one region of two texts of a file is one region; a region of
 * a module the record does not hold is keyed by its row's id and ordinal, so
 * two texts of one file never meet.
 */
function readReading(root: string, { story, files, regions }: Loaded, names: Map<string, PlaceDifference>, moments: Map<string, Moment>, before: boolean): Read {
  const shown = files.map((file) => inCheckout(root, file));
  const declarations = regions.map((own, row) => (own === undefined ? undefined : placesOf(shown[row]!, own)));
  const bases: number[] = [];
  let total = 0;
  for (const [, count] of story.rows) {
    bases.push(total);
    total += count;
  }
  const read: Read = { regions: new Set(), said: new Set(), first: new Map() };
  // A line is kept with how many times it was said: an extra commit says its
  // lines again, and is how two tests most often render apart.
  const times = new Map<string, number>();
  let clock = 0;
  const arrive = (key: string, moment: Moment): void => {
    if (!moments.has(key)) moments.set(key, moment);
    if (!read.first.has(key)) read.first.set(key, clock);
    clock += 1;
  };
  const hear = (said: string): void => {
    const text = acrossRuns(said);
    times.set(text, (times.get(text) ?? 0) + 1);
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
      const own = regions[row]?.[ordinal];
      const coordinate = declarations[row]?.at[ordinal];
      const key = coordinate ?? `${story.rows[row]![0]}\0${ordinal}`;
      const place: Place = own === undefined
        ? { file, name: '', kind: 'module', at: file }
        : declarations[row]!.places[ordinal]!;
      if (!names.has(key)) {
        const construct = own === undefined || coordinate === undefined
          ? undefined
          : ifLine(coordinate, regions[row]!, declarations[row]!.at);
        names.set(key, {
          place,
          path: own?.path ?? `region ${ordinal}`,
          ...(coordinate === undefined ? {} : { at: coordinate }),
          ...(own?.startLine === undefined ? {} : { startLine: own.startLine, endLine: own.endLine }),
          ...(construct === undefined ? {} : { constructLine: construct }),
        });
      }
      read.regions.add(key);
      if (!read.first.has(`r${key}`)) read.first.set(`r${key}`, clock);
      if (visit & stories.EVALUATING) arrive(`m\0loaded\0${file}`, { loaded: file });
      else arrive(`m\0${place.at}`, { place });
    }
  };
  if (before) walk(story.before, story.beforeNotes);
  const start = clock;
  walk(story.visits, story.notes);
  for (const [text, count] of times) read.said.add(`${text}\0${count}`);
  if (story.parts !== undefined) {
    // A part or a line placed after `at` visits and `said` notes opens at tick `at + said`.
    const opens = (cuts: readonly (readonly [number, ...(number | undefined)[]])[], said: number): number[] => cuts.map((cut) => cut[0] + cut[said]!);
    const parts = opens(story.parts, 1);
    const lines = opens(story.lines, 2);
    const last = (ticks: readonly number[], tick: number): number => {
      let at = -1;
      while (at + 1 < ticks.length && ticks[at + 1]! <= tick) at += 1;
      return at;
    };
    const realms = new Map<string, readonly [number, number]>();
    for (const [key, tick] of read.first) {
      if (!key.startsWith('m\0')) continue;
      const own = tick - start;
      // What ran before the case is one realm and one line of its own; what the
      // runner said before any page drained is the runner's.
      const part = last(parts, own);
      realms.set(key, own < 0 ? [-1, -2] : [part === -1 ? 0 : story.parts[part]![2], last(lines, own)]);
    }
    return { ...read, realms };
  }
  return read;
}

/** Where the `then` of the `if` an arm belongs to starts, from the module's regions; nothing for any other region. */
function ifLine(arm: string, regions: readonly Region[], at: readonly string[]): number | undefined {
  const match = /[#/]if#\d+\/(then|else)$/.exec(arm);
  if (match === null) return undefined;
  const then = `${arm.slice(0, -match[1]!.length)}then`;
  const index = at.indexOf(then);
  return index === -1 ? undefined : regions[index]?.startLine;
}

/**
 * What every reading of some sides has and no reading of the rest, by the
 * positions of the sides that hold it joined by commas; and how many things
 * some side has on some of its readings only. What every side holds is no difference.
 * A group's keys come in the order the newest reading of its first side
 * reached them: no side before that one holds them, and that reading holds
 * every one, so it is where each is first met.
 */
function steady(sides: readonly (readonly Read[])[], of: (read: Read) => ReadonlySet<string>): { held: Map<string, string[]>; unsteady: number } {
  const held = new Map<string, string[]>();
  let unsteady = 0;
  for (const key of new Set(sides.flatMap((reads) => reads.flatMap((read) => [...of(read)])))) {
    const counts = sides.map((reads) => reads.filter((read) => of(read).has(key)).length);
    if (counts.some((count, at) => count > 0 && count < sides[at]!.length)) {
      unsteady += 1;
      continue;
    }
    const holders = counts.flatMap((count, at) => (count > 0 ? [at] : []));
    if (holders.length === sides.length) continue;
    const group = holders.join(',');
    held.set(group, [...held.get(group) ?? [], key]);
  }
  return { held, unsteady };
}

/**
 * Pairs of moments every reading reaches, in an order each side holds on every
 * reading and not every side the same, with the positions of the sides that
 * reach the first of the pair first; and how many pairs changed order between
 * readings of one side. Two moments of a page case reached in two frames, or a
 * frame and the runner, under one test line have no order: the story holds the
 * order their drains reached the runner in, so no reading compares them.
 */
function orderedPairs(sides: readonly (readonly Read[])[]): { differing: { pair: [string, string]; before: number[] }[]; unsteady: number } {
  const all = sides.flat();
  const moments = [...(all[0]?.first.keys() ?? [])].filter((key) => key.startsWith('m\0') && all.every((read) => read.first.has(key)));
  // In the order the first side's newest reading reached them, so each pair is
  // read earlier-first there, and the first side is always among `before`.
  moments.sort((one, two) => all[0]!.first.get(one)! - all[0]!.first.get(two)!);
  const differing: { pair: [string, string]; before: number[] }[] = [];
  let unsteady = 0;
  // Each moment's first arrival is a tick of its own, so two moments are never
  // level; two arrivals in two realms under one test line have no order.
  const ahead = (read: Read, [one, two]: readonly [string, string]): boolean | undefined => {
    const [left, right] = [read.realms?.get(one), read.realms?.get(two)];
    if (left !== undefined && right !== undefined && left[0] !== right[0] && left[1] === right[1]) return undefined;
    return read.first.get(one)! < read.first.get(two)!;
  };
  for (let at = 0; at < moments.length; at += 1) {
    for (let next = at + 1; next < moments.length; next += 1) {
      const pair: [string, string] = [moments[at]!, moments[next]!];
      const leads = sides.map((reads) => reads.map((read) => ahead(read, pair)));
      if (leads.some((side) => side.includes(undefined))) continue;
      const held = leads.map((side) => (side.every((lead) => lead === side[0]) ? side[0] : undefined));
      if (held.some((lead) => lead === undefined)) unsteady += 1;
      else if (held.some((lead) => !lead)) differing.push({ pair, before: held.flatMap((lead, side) => (lead ? [side] : [])) });
    }
  }
  return { differing, unsteady };
}
