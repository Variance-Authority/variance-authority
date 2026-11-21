import type { RowSpan } from '@variance-authority/raster';
import type { PairedRows } from './align.js';

/**
 * The rows content pushed down by a height that is not whole rows straddles.
 *
 * A banner 23.5 rows tall moves text by 23 or 24 rows and draws an edge across
 * the two rows it half covers, which then match no row. Between two exactly
 * paired rows whose moves are `low` and `low + 1`, a stretch whose rows each
 * lie between their two counterparts is that move: each after row is paired
 * with the closer one. A stretch of copies, a gap a row taller, joins only
 * beside a blending stretch of the same `low`. `costs` holds what each after
 * row's pairing leaves differing, an unpaired row its width, and is kept true
 * for the rows paired anew.
 */
export function straddled(
  rows: PairedRows,
  was: Uint32Array,
  now: Uint32Array,
  beforeHeight: number,
  width: number,
  cost: (beforeRow: number, afterRow: number) => number,
  costs: Int32Array,
): PairedRows {
  const source = rows.source;
  const height = source.length;
  const image: Image = { was, now, width };

  // In page order; `undefined` where the move jumps by more than a row.
  const stretches: (Stretch | undefined)[] = [];
  let last = -1;
  for (let y = 0; y < height; y += 1) {
    const from = source[y]!;
    if (from < 0 || costs[y] !== 0) continue;
    if (last >= 0) {
      const top = source[last]!;
      const above = last - top;
      const below = y - from;
      if (Math.abs(above - below) <= 1 && (y - last > 1 || from - top !== 1)) {
        const stretch = { last, y, top, from, low: -1, blended: false, bridged: false };
        for (const low of above === below ? [above - 1, above] : [Math.min(above, below)]) {
          const blended = fractional(stretch, low, image);
          if (blended === undefined) continue;
          Object.assign(stretch, { low, blended, bridged: blended });
          break;
        }
        stretches.push(stretch);
      } else if (Math.abs(above - below) > 1) {
        stretches.push(undefined);
      }
    }
    last = y;
  }
  // A copy-only stretch joins the blended move next to it, up the page and down.
  for (const order of [stretches, [...stretches].reverse()]) {
    order.forEach((stretch, index) => {
      const next = order[index - 1];
      if (stretch?.bridged === false && stretch.low >= 0 && next?.bridged && next.low === stretch.low) {
        stretch.bridged = true;
      }
    });
  }
  const bridged = stretches.filter((stretch) => stretch?.bridged === true) as Stretch[];
  if (bridged.length === 0) return rows;

  // The after rows a stretch holds, each joined to the shift above it.
  const joined = new Uint8Array(height);
  const held = new Uint8Array(beforeHeight);
  for (const { last: open, y, top, from, low } of bridged) {
    for (let gap = open + 1; gap < y; gap += 1) {
      const upper = gap - low - 1;
      const high = cost(upper, gap);
      const under = cost(upper + 1, gap);
      source[gap] = high <= under ? upper : upper + 1;
      costs[gap] = Math.min(high, under);
    }
    joined.fill(1, open + 1, y + 1);
    held.fill(1, top + 1, from);
  }

  return regrouped(rows, joined, (row) => held[row] === 1);
}

/**
 * The spans of `rows` once a pass has paired some of its rows anew in `rows.source`:
 * a shift runs while its rows move alike or are `joined` to the row above, and
 * moves by what most of its rows move by, so content a fraction of a row lower
 * stays one shift. The inserted and grown rows left are those still unpaired,
 * and the removed and shrunk ones those `held` does not hold.
 */
export function regrouped(rows: PairedRows, joined: Uint8Array, held: (row: number) => boolean): PairedRows {
  const { source } = rows;
  const height = source.length;
  const unpaired = (span: RowSpan): RowSpan[] => spans(span.from, span.to, (y) => source[y]! < 0);
  const free = <Span extends RowSpan & { readonly at: number }>(span: Span): Span[] =>
    spans(span.from, span.to, (row) => !held(row)).map((part) => ({ ...span, ...part }));

  const shifted: { from: number; to: number; last: number; moved: Map<number, number> }[] = [];
  for (let y = 0; y < height; y += 1) {
    const from = source[y]!;
    if (from < 0 || y === from) continue;
    const by = y - from;
    const open = shifted.at(-1);
    if (open !== undefined && open.to === y && (open.last === by || joined[y])) {
      open.to = y + 1;
      open.last = by;
      open.moved.set(by, (open.moved.get(by) ?? 0) + 1);
    } else {
      shifted.push({ from: y, to: y + 1, last: by, moved: new Map([[by, 1]]) });
    }
  }
  return {
    source,
    inserted: rows.inserted.flatMap(unpaired),
    removed: rows.removed.flatMap(free),
    shifted: shifted.map(({ from, to, moved }) => ({
      from,
      to,
      by: [...moved].reduce((best, entry) => (entry[1] > best[1] ? entry : best))[0],
    })),
    grown: rows.grown.flatMap(unpaired),
    shrunk: rows.shrunk.flatMap(free),
  };
}

interface Stretch {
  /** The exactly paired after rows it lies between, and their before rows. */
  readonly last: number;
  readonly y: number;
  readonly top: number;
  readonly from: number;
  /** The whole rows of the move by `low` and a half that fits it, or -1. */
  low: number;
  /** Whether a row of it mixes its two and is a copy of neither. */
  blended: boolean;
  bridged: boolean;
}

interface Image {
  readonly was: Uint32Array;
  readonly now: Uint32Array;
  readonly width: number;
}

/**
 * Whether a move by `low` and a fraction draws the stretch, and if it does,
 * whether a row of it blends its two; `undefined` where it does not.
 */
function fractional(stretch: Stretch, low: number, image: Image): boolean | undefined {
  const { was, now, width } = image;
  const { last, y, top, from } = stretch;
  // After row `row` falls across before rows `row - low - 1` and the next.
  const after = new Spread();
  for (let row = last + 1; row < y; row += 1) after.row(now, row, was, row - low - 1, width);
  // Before row `row` falls across after rows `row + low` and the next.
  const before = new Spread();
  for (let row = top + 1; row < from; row += 1) before.row(was, row, now, row + low, width);
  const fromAfter = after.all(y - last - 1) && accounted(top + 1, from, before.rows, after.picks);
  const fromBefore = before.all(from - top - 1) && accounted(last + 1, y, after.rows, before.picks);
  if (fromAfter && after.blended) return true;
  if (fromBefore && before.blended) return true;
  return fromAfter || fromBefore ? false : undefined;
}

/** Whether every row from `first` to `end` spreads, or is one the other image's rows chose. */
function accounted(first: number, end: number, spread: ReadonlySet<number>, picks: ReadonlySet<number>): boolean {
  for (let row = first; row < end; row += 1) if (!spread.has(row) && !picks.has(row)) return false;
  return true;
}

/**
 * Rows of one image read as the rows of the other drawn a fraction of a row
 * lower: each channel between its value in the row above and the row below,
 * within two either way. A row blends its two when it stands apart from each
 * across most of what tells them apart; one that only a pixel or two keeps
 * from being a copy of either is that copy with those pixels changed.
 */
class Spread {
  /** The rows that fit, until one does not. */
  readonly rows = new Set<number>();
  /** Of each fitting row's two, the one it is closer to: the upper on a tie. */
  readonly picks = new Set<number>();
  /** Whether a fitting row blends its two. */
  blended = false;
  private broken = false;

  /** Whether every one of `count` rows fit. */
  all(count: number): boolean {
    return !this.broken && this.rows.size === count;
  }

  row(rows: Uint32Array, row: number, other: Uint32Array, upper: number, width: number): void {
    if (this.broken) return;
    const at = row * width;
    const above = upper * width;
    let apart = 0;
    let fromHigh = 0;
    let fromLow = 0;
    for (let x = 0; x < width; x += 1) {
      const value = rows[at + x]!;
      const high = other[above + x]!;
      const low = other[above + width + x]!;
      if (high !== low) apart += 1;
      if (value !== high) fromHigh += 1;
      if (value !== low) fromLow += 1;
      if (value === high || value === low) continue;
      for (let shift = 0; shift < 32; shift += 8) {
        const channel = (value >>> shift) & 0xff;
        const one = (high >>> shift) & 0xff;
        const two = (low >>> shift) & 0xff;
        if (channel < Math.min(one, two) - 2 || channel > Math.max(one, two) + 2) {
          this.broken = true;
          return;
        }
      }
    }
    this.blended ||= Math.min(fromHigh, fromLow) * 2 > apart;
    this.rows.add(row);
    this.picks.add(fromHigh <= fromLow ? upper : upper + 1);
  }
}

/** The parts of `from`..`to` whose rows `keep` holds. */
function spans(from: number, to: number, keep: (row: number) => boolean): RowSpan[] {
  const out: RowSpan[] = [];
  for (let row = from; row < to; row += 1) {
    if (!keep(row)) continue;
    const open = out.at(-1);
    if (open !== undefined && open.to === row) out[out.length - 1] = { from: open.from, to: row + 1 };
    else out.push({ from: row, to: row + 1 });
  }
  return out;
}
