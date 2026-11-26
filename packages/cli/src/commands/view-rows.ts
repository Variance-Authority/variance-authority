// compass: variance-authority.reach.crossings
/**
 * What the page `variance view` writes is made of: tables read a row at a time,
 * and the one thing looked at by itself. Nothing here knows the record.
 */

/** What a cell holds; undefined where the record does not say. */
export type Cell = string | number | undefined;

/** A stretch of a clock, and what it is made of, in percent of the whole. */
export interface Bar {
  readonly left: number;
  readonly width: number;
  readonly title: string;
  readonly parts: readonly { readonly name: string; readonly share: number }[];
}

export interface Column {
  readonly name: string;
  at(row: number): Cell;
  /** How a number is written: a duration, an instant, or itself where absent. */
  readonly as?: 'ms' | 'time';
  /** The address a cell opens, without its `#`. */
  link?(row: number): string | undefined;
  /** Drawn in place of the value, which is what the column sorts by. */
  bar?(row: number): Bar | undefined;
}

/** Every row of one thing the record holds; a row is read when it is asked for. */
export interface Table {
  readonly id: string;
  readonly label: string;
  readonly hint: string;
  readonly count: number;
  readonly columns: readonly Column[];
}

/** One thing looked at by itself: its facts, the tables about it, and text the record keeps as it is. */
export interface Detail {
  readonly title: string;
  readonly facts: readonly (readonly [name: string, value: Cell, as?: Column['as']])[];
  readonly tables: readonly Table[];
}

/** `table`'s `rows` alone, in that order. */
export function rowsOf(table: Table, rows: ArrayLike<number>, named: Pick<Table, 'id' | 'label' | 'hint'>): Table {
  const pick = (column: Column): Column => ({
    name: column.name,
    at: (row) => column.at(rows[row]!),
    ...(column.as === undefined ? {} : { as: column.as }),
    ...(column.link === undefined ? {} : { link: (row: number) => column.link!(rows[row]!) }),
    ...(column.bar === undefined ? {} : { bar: (row: number) => column.bar!(rows[row]!) }),
  });
  return { ...named, count: rows.length, columns: table.columns.map(pick) };
}

/** A table of what is already values: one array of cells to a row. */
export function listed(named: Pick<Table, 'id' | 'label' | 'hint'>, names: readonly string[], rows: readonly (readonly Cell[])[]): Table {
  return { ...named, count: rows.length, columns: names.map((name, at) => ({ name, at: (row) => rows[row]?.[at] })) };
}

/** An address: what kind of thing, and which one. */
export const address = (kind: string, key: string | number): string => `${kind}/${encodeURIComponent(String(key))}`;

/** `value`, or undefined where it is the format's word for none. */
export const unless = (value: number | undefined, none: number): number | undefined => (value === none ? undefined : value);

/** A flag as a word. */
export const yes = (value: boolean | number): string => (value ? 'yes' : 'no');

/** The owner of `row`, among owners whose rows begin at `offsets`. */
export function ownerOf(offsets: ArrayLike<number>, row: number): number {
  let low = 0;
  let high = offsets.length - 2;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (offsets[middle]! <= row) low = middle;
    else high = middle - 1;
  }
  return low;
}

/** The whole numbers from `from` up to `to`. */
export const span = (from: number, to: number): Uint32Array => Uint32Array.from({ length: Math.max(to - from, 0) }, (_, at) => from + at);

/** A value read once, when it is first asked for. */
export function once<T>(read: () => T): () => T {
  let held: { readonly value: T } | undefined;
  return () => (held ??= { value: read() }).value;
}

/** An answer by number, worked out once for each. */
export function each<T>(read: (at: number) => T): (at: number) => T {
  const held = new Map<number, T>();
  return (at) => {
    if (!held.has(at)) held.set(at, read(at));
    return held.get(at)!;
  };
}

/** A set of rows, by the id of the set a region was given. */
export interface Sets {
  readonly size: number;
  has(set: number, member: number): boolean;
  count(set: number): number;
  members(set: number): Uint32Array;
}

/** The regions `member` entered: a set is asked once, however many regions hold it. */
export function entered(sets: Sets, regions: ArrayLike<number>, member: number): Uint32Array {
  const holds = each((set) => sets.has(set, member));
  const rows: number[] = [];
  for (let row = 0; row < regions.length; row += 1) if (holds(regions[row]!)) rows.push(row);
  return Uint32Array.from(rows);
}

/** How many regions each of `members` rows entered. */
export function enteredCounts(sets: Sets, regions: ArrayLike<number>, members: number): Uint32Array {
  const held = new Uint32Array(sets.size);
  for (let row = 0; row < regions.length; row += 1) held[regions[row]!]! += 1;
  const counts = new Uint32Array(members);
  held.forEach((regionsHeld, set) => {
    if (regionsHeld > 0) for (const member of sets.members(set)) counts[member]! += regionsHeld;
  });
  return counts;
}

/** Rows gathered by what they are called. */
export function gathered(count: number, name: (row: number) => string): Map<string, number[]> {
  const held = new Map<string, number[]>();
  for (let row = 0; row < count; row += 1) {
    const key = name(row);
    const rows = held.get(key);
    if (rows === undefined) held.set(key, [row]);
    else rows.push(row);
  }
  return held;
}
