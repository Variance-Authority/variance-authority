import { PNG } from 'pngjs';
import type { DiffRegion } from '@variance-authority/core/attribute';
import { DEFAULT_POLICY, type DiffPolicy, type RowSpan } from '@variance-authority/raster';
import { alignRows, type AlignedRows } from './align.js';
import { drawSheet, type Gap, type Mark, type Moved, type SheetRow } from './change-draw.js';
import { differencePixels, type DecodedImage } from './mask.js';

export { CHANGE_COLOURS, changeLayout } from './change-draw.js';

/**
 * The change at its own size: what a reviewer reads in place of two pages.
 *
 * A full-page capture is 1280 pixels wide and tens of thousands tall. Shown
 * whole in a pull request comment it is scaled to the column, a sentence of it
 * is a grey line, and a reviewer cannot read what changed without downloading
 * both pages and finding the spot by eye. The regions of a comparison already
 * say where to look, so the picture is cut there: each of the largest regions,
 * with the rows around it, at one image pixel per screen pixel.
 *
 * Each cut is a split diff, the way a code review shows text: before on the
 * left, after on the right, and the rows that show the same content level with
 * each other, read through the row alignment. An inserted row stands opposite
 * stripes on the before side and a removed one opposite stripes on the after
 * side, so everything under an insertion sits beside itself and reads as
 * unchanged. What changed is outlined on both sides, red on before and green on
 * after, around the pages' own pixels. Rows that only moved are not outlined:
 * the gutter beside them carries a bar and a chevron the way they went, and a
 * gap that only got taller is neither outlined nor cut out while anything else
 * changed.
 */
export interface ChangeImages {
  /** The whole difference: the after image dimmed with the changed pixels in red. */
  readonly diff: Buffer;
  /** The cuts, before beside after, one under another. Absent when there was no region to cut. */
  readonly change?: Buffer;
}

/** Rows and columns of context kept around a region, so it is seen in place. */
const CONTEXT_ROWS = 32;
const CONTEXT_COLUMNS = 48;
/** The narrowest crop, wide enough for a short sentence of body text. */
const MIN_WIDTH = 320;
/** The tallest sheet; an inserted section keeps its top, which is where it starts. */
const MAX_ROWS = 400;
/** Cuts per picture. A reviewer reads the largest few and the sentence counts the rest. */
const MAX_WINDOWS = 3;
/** Between two cuts. */
const WINDOW_GAP = { rows: 12, colour: [0x57, 0x60, 0x6a, 0xff] } as const;
/** How far an outline moves out to find a blank row to run along. */
const SNAP_ROWS = 12;
/** Pixels unlike a row's background that a blank row may still hold: a box's two borders and their anti-aliasing. */
const BORDER_PIXELS = 4;
/**
 * Rows a gap may grow or shrink by and still be rounding: content moved by a
 * fraction of a pixel lands each gap under it a row taller or shorter. A gap
 * that changed by more is spacing that changed, and gets a window and a mark.
 */
const ROUNDING_ROWS = 1;
/** Two outlines closer than this, in rows and columns, are one. */
const MERGE_DISTANCE = 16;

interface Window {
  left: number;
  top: number;
  right: number;
  bottom: number;
  weight: number;
  /** Whether anything in it changed, rather than a gap only growing or shrinking. */
  changed: boolean;
}

/**
 * The difference image and the cuts of it, from one alignment.
 *
 * `regions` are the comparison's, on its canvas: the after image's when the
 * rows aligned, the box that holds both when they did not. The difference is
 * computed here on the same rule, so the two agree on where every pixel is.
 */
export function changeImages(
  before: Buffer,
  after: Buffer,
  regions: readonly DiffRegion[],
  policy: DiffPolicy = DEFAULT_POLICY,
): ChangeImages {
  const was = PNG.sync.read(before);
  const now = PNG.sync.read(after);
  const alignment = alignRows(was, now);
  const difference = differencePixels(was, now, policy, { alignment: alignment ?? null });
  const diff = encode(difference);
  // The comparison's canvas is the after image's only when it used the alignment.
  const rows = difference.alignment === undefined ? undefined : alignment;

  const changed = regions.filter((region) => !displacement(region, rows));
  const spacing = (span: RowSpan) => span.to - span.from > ROUNDING_ROWS;
  const gaps = regions.filter(
    (region) =>
      displacement(region, rows) &&
      rows!.grown.some((span) => spacing(span) && span.from < region.y + region.height && span.to > region.y),
  );
  const lost = (span: RowSpan & { readonly at: number }) =>
    rows!.shrunk.some((shrunk) => shrunk.from === span.from && shrunk.at === span.at);
  const removed = (rows?.removed ?? []).filter((span) => !lost(span));
  const { width, height } = difference;
  // A gap that only grew or shrank is cut out too, after every change: it is
  // what moved the rows below it, and without it they move for no reason.
  const windows = windowsFor(
    [...changed.map((region) => ({ region, changed: true })), ...gaps.map((region) => ({ region, changed: false }))],
    [
      ...removed.map((span) => ({ span, changed: true })),
      ...(rows?.removed ?? []).filter((span) => lost(span) && spacing(span)).map((span) => ({ span, changed: false })),
    ],
    width,
    height,
  );
  if (windows.length === 0) return { diff };

  const sheets = windows.map((window) => {
    const sheet = sheetRows(window, rows, was.height, now.height);
    const [left, right] = columnsFor(window, sheet, was, now, width);
    const marks = marksFor(sheet, changed, removed, was, now, width, left, right);
    return drawSheet(
      was,
      now,
      left,
      right,
      sheet.map(({ before, after }) => ({ before, after })),
      marks,
      movedFor(sheet, rows, marks),
      gapsFor(sheet),
    );
  });
  return { diff, change: encode(stack(sheets)) };
}

/** A region that is only rows a run of identical rows grew by: it moved what follows and changed nothing. */
function displacement(region: DiffRegion, rows: AlignedRows | undefined): boolean {
  if (rows === undefined || rows.grown.length === 0) return false;
  for (let y = region.y; y < region.y + region.height; y += 1) {
    if (!rows.grown.some((span) => y >= span.from && y < span.to)) return false;
  }
  return true;
}

/** Columns `left` to `right` with context, at least `MIN_WIDTH`, slid back onto a canvas `width` wide. */
function padded(left: number, right: number, width: number): [number, number] {
  const grow = Math.max(0, MIN_WIDTH - (right - left + 2 * CONTEXT_COLUMNS));
  let from = left - CONTEXT_COLUMNS - Math.floor(grow / 2);
  let to = right + CONTEXT_COLUMNS + Math.ceil(grow / 2);
  if (from < 0) [from, to] = [0, to - from];
  if (to > width) [from, to] = [Math.max(0, from - (to - width)), width];
  return [from, Math.min(width, to)];
}

/**
 * Where to cut: each region and each removal, padded with context, merged where they meet, the heaviest kept and read
 * top to bottom.
 */
function windowsFor(
  regions: readonly { readonly region: DiffRegion; readonly changed: boolean }[],
  removed: readonly { readonly span: RowSpan & { readonly at: number }; readonly changed: boolean }[],
  width: number,
  height: number,
): Window[] {
  const window = (left: number, top: number, right: number, bottom: number, weight: number, changed: boolean): Window => {
    const [from, to] = padded(left, right, width);
    return {
      left: from,
      right: to,
      top: Math.max(0, top - CONTEXT_ROWS),
      bottom: Math.min(height, bottom + CONTEXT_ROWS),
      weight,
      changed,
    };
  };

  const found = [
    ...regions.map(({ region, changed }) =>
      window(region.x, region.y, region.x + region.width, region.y + region.height, region.pixels, changed),
    ),
    // A removal has no after pixels to be a region of; it is a seam at `at`, and
    // weighs what it took away.
    ...removed.map(({ span, changed }) => window(0, span.at, width, span.at, (span.to - span.from) * width, changed)),
  ].filter((found) => found.bottom > found.top && found.right > found.left);

  const merged: Window[] = [];
  for (const next of found.sort((a, b) => a.top - b.top)) {
    const last = merged.at(-1);
    if (last !== undefined && next.top <= last.bottom) {
      last.left = Math.min(last.left, next.left);
      last.right = Math.max(last.right, next.right);
      last.bottom = Math.max(last.bottom, next.bottom);
      last.weight += next.weight;
      last.changed ||= next.changed;
    } else merged.push({ ...next });
  }

  return merged
    .sort((a, b) => Number(b.changed) - Number(a.changed) || b.weight - a.weight || a.top - b.top)
    .slice(0, MAX_WINDOWS)
    .sort((a, b) => a.top - b.top)
    .map((kept) => ({ ...kept, bottom: Math.min(kept.bottom, kept.top + MAX_ROWS) }));
}

/** A sheet row, with the canvas row it stands for: the after row when aligned, `-1` for a removed one. */
interface PlannedRow extends SheetRow {
  readonly canvas: number;
  /** A row a gap grew by, or the row a gap that shrank now ends on. */
  readonly gap?: 'grew' | 'shrank';
}

/**
 * The rows of one cut, top to bottom: each after row beside the before row it
 * shows, and each removed before row, at its seam, beside nothing. Without an
 * alignment the two are read position by position.
 */
function sheetRows(
  window: Window,
  rows: AlignedRows | undefined,
  beforeHeight: number,
  afterHeight: number,
): PlannedRow[] {
  const out: PlannedRow[] = [];
  for (let y = window.top; y <= window.bottom && out.length < MAX_ROWS; y += 1) {
    if (rows === undefined) {
      if (y < window.bottom) out.push({ before: y < beforeHeight ? y : -1, after: y < afterHeight ? y : -1, canvas: y });
      continue;
    }
    let shrank = false;
    for (const span of rows.removed) {
      if (span.at !== y) continue;
      if (rows.shrunk.some((lost) => lost.from === span.from && lost.at === span.at)) {
        shrank ||= span.to - span.from > ROUNDING_ROWS;
        continue;
      }
      for (let row = span.from; row < span.to && out.length < MAX_ROWS; row += 1) {
        out.push({ before: row, after: -1, canvas: -1 });
      }
    }
    if (y >= window.bottom || out.length >= MAX_ROWS) continue;
    // A row a run grew by is a copy of the run's row, and so is the before row
    // that run ends on: shown beside it, a gap that only got taller is not
    // drawn as a stripe of filler, and neither is one that got shorter.
    const grew = rows.grown.find((span) => y >= span.from && y < span.to);
    const before = grew === undefined || grew.from === 0 ? rows.source[y]! : rows.source[grew.from - 1]!;
    const gap = grew !== undefined && grew.to - grew.from > ROUNDING_ROWS ? 'grew' : shrank ? 'shrank' : undefined;
    out.push(gap === undefined ? { before, after: y, canvas: y } : { before, after: y, canvas: y, gap });
  }
  return out;
}

/**
 * The columns of one cut. A cut as wide as the page, which is what an inserted
 * or removed row makes, is narrowed to the columns that hold anything on its
 * rows, so a column of text is not shown at a quarter of its size beside the
 * margins of a 1280-pixel page.
 */
function columnsFor(
  window: Window,
  sheet: readonly PlannedRow[],
  was: DecodedImage,
  now: DecodedImage,
  width: number,
): [number, number] {
  if (window.left > 0 || window.right < width || width <= MIN_WIDTH) return [window.left, window.right];
  const ink = inkOf([
    ...sheet.filter((row) => row.before >= 0).map((row) => [was, row.before] as const),
    ...sheet.filter((row) => row.after >= 0).map((row) => [now, row.after] as const),
  ]);
  return ink === undefined ? [window.left, window.right] : padded(ink[0], ink[1], width);
}

/** The columns where any of `rows` differs from its own leftmost pixel: where it holds something. */
function inkOf(rows: readonly (readonly [DecodedImage, number])[]): [number, number] | undefined {
  let left = Infinity;
  let right = -Infinity;
  for (const [image, y] of rows) {
    const start = y * image.width * 4;
    const background = image.data.subarray(start, start + 4);
    const holds = (x: number) => {
      const at = start + x * 4;
      return (
        image.data[at] !== background[0] ||
        image.data[at + 1] !== background[1] ||
        image.data[at + 2] !== background[2] ||
        image.data[at + 3] !== background[3]
      );
    };
    let x = 0;
    while (x < image.width && !holds(x)) x += 1;
    if (x === image.width) continue;
    left = Math.min(left, x);
    let end = image.width - 1;
    while (end >= Math.max(x, right) && !holds(end)) end -= 1;
    right = Math.max(right, end + 1);
  }
  return left < right ? [left, right] : undefined;
}

/**
 * The outlines of one cut: each changed region on both sides where that side
 * has a row, and each removal on the before side, merged where they touch.
 */
function marksFor(
  sheet: readonly PlannedRow[],
  regions: readonly DiffRegion[],
  removed: readonly (RowSpan & { readonly at: number })[],
  was: DecodedImage,
  now: DecodedImage,
  width: number,
  left: number,
  right: number,
): Mark[] {
  const marks: Mark[] = [];
  const add = (side: Mark['side'], indices: readonly number[], columns: [number, number]) => {
    if (indices.length === 0) return;
    const from = Math.max(columns[0], left) - left;
    const to = Math.min(columns[1], right) - left;
    if (to <= from) return;
    marks.push({ side, top: indices[0]!, bottom: indices.at(-1)! + 1, left: from, right: to });
  };

  for (const region of regions) {
    const indices = sheet.flatMap((row, index) =>
      row.canvas >= region.y && row.canvas < region.y + region.height ? [index] : [],
    );
    if (indices.length === 0) continue;
    for (const side of ['before', 'after'] as const) {
      const own = indices.filter((index) => sheet[index]![side] >= 0);
      const image = side === 'before' ? was : now;
      // An inserted row is marked across the page; outline what is on it.
      const columns: [number, number] =
        region.width >= width ? (inkOf(own.map((index) => [image, sheet[index]![side]] as const)) ?? [0, width]) : [region.x, region.x + region.width];
      add(side, own, columns);
    }
  }

  for (const span of removed) {
    const indices = sheet.flatMap((row, index) =>
      row.after < 0 && row.before >= span.from && row.before < span.to ? [index] : [],
    );
    add('before', indices, inkOf(indices.map((index) => [was, sheet[index]!.before] as const)) ?? [0, width]);
  }

  // An edge that cuts through a line of text moves out to the blank row past
  // it, and one on a blank row moves in to the first that holds anything, so
  // the outline runs in the gap between lines rather than through one.
  return merge(marks).map((mark) => {
    const image = mark.side === 'before' ? was : now;
    const busy = (index: number) => {
      const row = sheet[index]?.[mark.side] ?? -1;
      return row >= 0 && inked(image, row, mark.left + left, mark.right + left);
    };
    let { top, bottom } = mark;
    for (let step = 0; step < SNAP_ROWS && busy(top) && busy(top - 1); step += 1) top -= 1;
    for (let step = 0; step < SNAP_ROWS && busy(bottom - 1) && busy(bottom); step += 1) bottom += 1;
    if (Array.from({ length: bottom - top }, (_, at) => top + at).some(busy)) {
      while (!busy(top)) top += 1;
      while (!busy(bottom - 1)) bottom -= 1;
    }
    return { ...mark, top, bottom };
  });
}

/**
 * Whether row `y` holds anything between columns `from` and `to`: more than a
 * border's worth of pixels unlike the colour most of that stretch is.
 */
function inked(image: DecodedImage, y: number, from: number, to: number): boolean {
  const end = Math.min(to, image.width);
  if (end <= from) return false;
  const words = new Uint32Array(Uint8Array.from(image.data.subarray((y * image.width + from) * 4, (y * image.width + end) * 4)).buffer);
  const counts = new Map<number, number>();
  let background = words[0]!;
  for (const word of words) {
    const count = (counts.get(word) ?? 0) + 1;
    counts.set(word, count);
    if (count > counts.get(background)!) background = word;
  }
  return words.length - counts.get(background)! > BORDER_PIXELS;
}

/** Outlines on one side that overlap or nearly touch, as one. */
function merge(marks: readonly Mark[]): Mark[] {
  const out: Mark[] = [];
  for (const mark of [...marks].sort((a, b) => a.top - b.top)) {
    const near = out.find(
      (other) =>
        other.side === mark.side &&
        mark.top <= other.bottom + MERGE_DISTANCE &&
        other.top <= mark.bottom + MERGE_DISTANCE &&
        mark.left <= other.right + MERGE_DISTANCE &&
        other.left <= mark.right + MERGE_DISTANCE,
    );
    if (near === undefined) {
      out.push(mark);
      continue;
    }
    out[out.indexOf(near)] = {
      side: mark.side,
      top: Math.min(near.top, mark.top),
      bottom: Math.max(near.bottom, mark.bottom),
      left: Math.min(near.left, mark.left),
      right: Math.max(near.right, mark.right),
    };
  }
  return out;
}

/**
 * The runs of sheet rows the alignment paired at another height and nothing
 * outlines: content that only moved. A row inside an outline or beside filler
 * is the change itself, even where it also moved.
 */
function movedFor(sheet: readonly PlannedRow[], rows: AlignedRows | undefined, marks: readonly Mark[]): Moved[] {
  if (rows === undefined) return [];
  const out: Moved[] = [];
  sheet.forEach((row, index) => {
    if (row.before < 0 || row.after < 0 || marks.some((mark) => index >= mark.top && index < mark.bottom)) return;
    const span = rows.shifted.find((shift) => row.after >= shift.from && row.after < shift.to);
    if (span === undefined) return;
    const last = out.at(-1);
    if (last !== undefined && last.bottom === index && last.down === span.by > 0) out[out.length - 1] = { ...last, bottom: index + 1 };
    else out.push({ top: index, bottom: index + 1, down: span.by > 0 });
  });
  return out;
}

/** Where a gap grew, as runs of sheet rows, and where one shrank, as an empty run at the row it now ends on. */
function gapsFor(sheet: readonly PlannedRow[]): Gap[] {
  const out: Gap[] = [];
  sheet.forEach((row, index) => {
    if (row.gap === 'shrank') out.push({ top: index, bottom: index });
    if (row.gap !== 'grew') return;
    const last = out.at(-1);
    if (last !== undefined && last.bottom === index && last.bottom > last.top) out[out.length - 1] = { ...last, bottom: index + 1 };
    else out.push({ top: index, bottom: index + 1 });
  });
  return out;
}

/** Sheets top to bottom, left-aligned on white, gaps between them. */
function stack(sheets: readonly DecodedImage[]): DecodedImage {
  const width = Math.max(...sheets.map((sheet) => sheet.width));
  const height = sheets.reduce((sum, sheet) => sum + sheet.height, 0) + WINDOW_GAP.rows * (sheets.length - 1);
  const data = new Uint8Array(width * height * 4).fill(0xff);
  let y = 0;
  sheets.forEach((sheet, index) => {
    if (index > 0) {
      for (let at = y * width * 4; at < (y + WINDOW_GAP.rows) * width * 4; at += 4) data.set(WINDOW_GAP.colour, at);
      y += WINDOW_GAP.rows;
    }
    for (let row = 0; row < sheet.height; row += 1) {
      data.set(sheet.data.subarray(row * sheet.width * 4, (row + 1) * sheet.width * 4), (y + row) * width * 4);
    }
    y += sheet.height;
  });
  return { width, height, data };
}

function encode(image: DecodedImage): Buffer {
  const out = new PNG({ width: image.width, height: image.height });
  out.data.set(image.data);
  return PNG.sync.write(out);
}
