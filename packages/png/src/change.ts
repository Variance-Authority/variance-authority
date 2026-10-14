import { PNG } from 'pngjs';
import type { DiffRegion } from '@variance-authority/core/attribute';
import { DEFAULT_POLICY, type DiffPolicy, type RowAlignment } from '@variance-authority/raster';
import { alignRows, differencePixels, type DecodedImage } from './mask.js';

/**
 * The change at its own size: what a reviewer reads in place of two pages.
 *
 * A full-page capture is 1280 pixels wide and tens of thousands tall. Shown
 * whole in a pull request comment it is scaled to the column, a sentence of it
 * is a grey line, and a reviewer cannot read what changed without downloading
 * both pages and finding the spot by eye. The regions of a comparison already
 * say where to look, so the picture is cut there: each of the largest regions,
 * with the rows around it, as before, after and the difference, at one image
 * pixel per screen pixel.
 *
 * The before panel is read through the row alignment, so an insertion shows the
 * before rows that sit either side of it rather than the unrelated rows that
 * happen to share its coordinates, and a removal shows the rows that went.
 */
export interface ChangeImages {
  /** The whole difference: the after image dimmed with the changed pixels in red. */
  readonly diff: Buffer;
  /** The crops, stacked top to bottom. Absent when there was no region to crop. */
  readonly change?: Buffer;
}

/** Rows and columns of context kept around a region, so it is seen in place. */
const CONTEXT_ROWS = 32;
const CONTEXT_COLUMNS = 48;
/** The narrowest crop, wide enough for a short sentence of body text. */
const MIN_WIDTH = 320;
/** The tallest panel; an inserted section keeps its top, which is where it starts. */
const MAX_ROWS = 400;
/** Crops per picture. A reviewer reads the largest few and the sentence counts the rest. */
const MAX_WINDOWS = 3;
/** Between the before, after and difference panels of one crop. */
const PANEL_GAP = { rows: 2, colour: [0xd0, 0xd7, 0xde, 0xff] } as const;
/** Between two crops. */
const WINDOW_GAP = { rows: 12, colour: [0x57, 0x60, 0x6a, 0xff] } as const;

interface Window {
  left: number;
  top: number;
  right: number;
  bottom: number;
  weight: number;
}

/**
 * The difference image and the crops of it, from one alignment.
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
  const rows = alignRows(was, now);
  const difference = differencePixels(was, now, policy, { alignment: rows ?? null });
  const diff = encode(difference);

  const windows = windowsFor(regions, difference.alignment, difference.width, difference.height);
  if (windows.length === 0) return { diff };

  const sheets = windows.map((window) => [
    crop(was, window.left, window.right, ...beforeRows(window, rows, was.height, difference.height)),
    crop(now, window.left, window.right, window.top, window.bottom),
    crop(difference, window.left, window.right, window.top, window.bottom),
  ]);
  return { diff, change: encode(stack(sheets)) };
}

/**
 * Where to cut: each region and each removal padded with context, merged where
 * they meet, the heaviest kept and read top to bottom.
 */
function windowsFor(
  regions: readonly DiffRegion[],
  alignment: RowAlignment | undefined,
  width: number,
  height: number,
): Window[] {
  const padded = (left: number, top: number, right: number, bottom: number, weight: number): Window => {
    const grow = Math.max(0, MIN_WIDTH - (right - left + 2 * CONTEXT_COLUMNS));
    let from = left - CONTEXT_COLUMNS - Math.floor(grow / 2);
    let to = right + CONTEXT_COLUMNS + Math.ceil(grow / 2);
    // Slide a crop that runs off one side back onto the canvas before clipping it.
    if (from < 0) [from, to] = [0, to - from];
    if (to > width) [from, to] = [Math.max(0, from - (to - width)), width];
    return {
      left: from,
      right: Math.min(width, to),
      top: Math.max(0, top - CONTEXT_ROWS),
      bottom: Math.min(height, bottom + CONTEXT_ROWS),
      weight,
    };
  };

  const found = [
    ...regions.map((region) =>
      padded(region.x, region.y, region.x + region.width, region.y + region.height, region.pixels),
    ),
    // A removal has no after pixels to be a region of; it is a seam at `at`, and
    // weighs what it took away.
    ...(alignment?.removed ?? []).map((span) => padded(0, span.at, width, span.at, (span.to - span.from) * width)),
  ].filter((window) => window.bottom > window.top && window.right > window.left);

  const merged: Window[] = [];
  for (const window of found.sort((a, b) => a.top - b.top)) {
    const last = merged.at(-1);
    if (last !== undefined && window.top <= last.bottom) {
      last.left = Math.min(last.left, window.left);
      last.right = Math.max(last.right, window.right);
      last.bottom = Math.max(last.bottom, window.bottom);
      last.weight += window.weight;
    } else merged.push({ ...window });
  }

  return merged
    .sort((a, b) => b.weight - a.weight || a.top - b.top)
    .slice(0, MAX_WINDOWS)
    .sort((a, b) => a.top - b.top)
    .map((window) => ({ ...window, bottom: Math.min(window.bottom, window.top + MAX_ROWS) }));
}

/**
 * The before rows a window shows: those its after rows were paired with, and
 * any removed between them, or the same rows when nothing was aligned.
 */
function beforeRows(
  window: Window,
  rows: (RowAlignment & { readonly source: Int32Array }) | undefined,
  height: number,
  canvas: number,
): [number, number] {
  if (rows === undefined) return [window.top, Math.min(window.bottom, window.top + MAX_ROWS)];

  let from = Infinity;
  let to = -Infinity;
  for (let y = window.top; y < window.bottom; y += 1) {
    const source = rows.source[y]!;
    if (source < 0) continue;
    from = Math.min(from, source);
    to = Math.max(to, source + 1);
  }
  for (const span of rows.removed) {
    if (span.at < window.top || span.at > window.bottom) continue;
    from = Math.min(from, span.from);
    to = Math.max(to, span.to);
  }
  // A window at an edge of the page shows the before image to the same edge, so
  // rows removed from the very top or bottom are not cut off.
  if (window.top === 0) from = 0;
  if (window.bottom === canvas) to = height;
  // Every after row in the window was inserted: the before image has nothing here.
  if (from > to) return [0, 0];
  return [from, Math.min(to, from + MAX_ROWS)];
}

/** Rows `top` to `bottom` and columns `left` to `right`, white where the image has none. */
function crop(image: DecodedImage, left: number, right: number, top: number, bottom: number): DecodedImage {
  const width = right - left;
  const height = Math.max(0, bottom - top);
  const data = new Uint8Array(width * height * 4).fill(0xff);
  const from = Math.min(left, image.width);
  const to = Math.min(right, image.width);
  for (let y = 0; y < height && top + y < image.height; y += 1) {
    const start = ((top + y) * image.width + from) * 4;
    data.set(image.data.subarray(start, start + (to - from) * 4), y * width * 4);
  }
  return { width, height, data };
}

/** Panels top to bottom, left-aligned on white, gaps between them. */
function stack(sheets: readonly (readonly DecodedImage[])[]): DecodedImage {
  const width = Math.max(...sheets.flat().map((panel) => panel.width));
  const pieces: (DecodedImage | { readonly rows: number; readonly colour: readonly number[] })[] = [];
  sheets.forEach((panels, index) => {
    if (index > 0) pieces.push(WINDOW_GAP);
    panels.forEach((panel, at) => {
      if (at > 0) pieces.push(PANEL_GAP);
      pieces.push(panel);
    });
  });

  const height = pieces.reduce((sum, piece) => sum + ('rows' in piece ? piece.rows : piece.height), 0);
  const data = new Uint8Array(width * height * 4).fill(0xff);
  let y = 0;
  for (const piece of pieces) {
    if ('rows' in piece) {
      for (let index = y * width * 4; index < (y + piece.rows) * width * 4; index += 4) {
        data.set(piece.colour, index);
      }
      y += piece.rows;
      continue;
    }
    for (let row = 0; row < piece.height; row += 1) {
      data.set(piece.data.subarray(row * piece.width * 4, (row + 1) * piece.width * 4), (y + row) * width * 4);
    }
    y += piece.height;
  }
  return { width, height, data };
}

function encode(image: DecodedImage): Buffer {
  const out = new PNG({ width: image.width, height: image.height });
  out.data.set(image.data);
  return PNG.sync.write(out);
}
