import type { DecodedImage } from './mask.js';
import { drawText, fitText, measureText } from './text.js';

/**
 * The pixels of a change sheet: a title, a label over each column, and under
 * them each window, before beside after, marked where they changed, with a
 * gutter between them that says which rows only moved.
 *
 * `change.ts` decides what is shown; this draws it. Nothing here reads an
 * alignment or a region, only rows, rectangles, colours and words.
 */

/** The colours of the sheet, exported so a test can find each part of it. */
export const CHANGE_COLOURS = {
  /** The before column's mark beside its label, and what changed on it. */
  before: [0xcf, 0x22, 0x2e, 0xff],
  /** The after column's mark beside its label, and what changed on it. */
  after: [0x1a, 0x7f, 0x37, 0xff],
  /** The gutter's mark beside rows that moved and did not change. */
  moved: [0x09, 0x69, 0xda, 0xff],
  /** Around and between the panels, the gutter included. */
  canvas: [0xf6, 0xf8, 0xfa, 0xff],
  /** The line around each panel, so a white page and a dark one both read as a picture. */
  frame: [0xd0, 0xd7, 0xde, 0xff],
  /** The title and the column labels. */
  ink: [0x1f, 0x23, 0x28, 0xff],
  /** Where each column came from, under the label's weight. */
  muted: [0x59, 0x63, 0x6e, 0xff],
  /** The stripes opposite rows the other side does not have. */
  filler: [
    [0xea, 0xee, 0xf2, 0xff],
    [0xd0, 0xd7, 0xde, 0xff],
  ],
} as const;

/**
 * The sizes of a sheet whose panels are `panel` pixels wide.
 *
 * The comment column scales a wide sheet down, so everything grows with the
 * crop: at 1280 a two-pixel line would vanish on a phone, and a label set at a
 * page's own size would be a smudge. One unit, the label's size, sets the
 * rhythm: the margin around the sheet and the space between two windows are
 * that unit, and so is the space under the labels.
 *
 * `titled` reserves the line the subject's name is set on.
 */
export function changeLayout(
  panel: number,
  titled = false,
): {
  stroke: number;
  gutter: number;
  frame: number;
  /** The label's size, and the margin around the sheet. */
  unit: number;
  /** The title's size. */
  title: number;
  /** From the sheet's top edge to the first window's first row. */
  header: number;
} {
  const stroke = Math.max(2, Math.ceil(panel / 120));
  const unit = Math.min(48, Math.max(13, Math.round(panel / 24)));
  const title = Math.round(unit * 1.15);
  const labels = Math.round(unit * 1.4);
  const header = unit + (titled ? Math.round(title * 1.5) : 0) + labels + Math.round(unit * 0.6);
  return { stroke, gutter: Math.max(4 * stroke + 4, Math.round(unit * 1.25)), frame: Math.max(1, Math.round(stroke / 3)), unit, title, header };
}

/** What a sheet says about itself: whose page, and where each side came from. */
export interface ChangeLabels {
  /** The subject the two pages are of. */
  readonly subject?: string;
  /** Where the before page came from, set beside "Before": a baseline, a commit. */
  readonly before?: string;
  /** Where the after page came from, set beside "After". */
  readonly after?: string;
}

/** One row of a sheet: the before row and the after row shown on it, `-1` for filler. */
export interface SheetRow {
  readonly before: number;
  readonly after: number;
}

/** A rectangle on one panel, in sheet rows and panel columns, end-exclusive. */
export interface Mark {
  readonly side: 'before' | 'after';
  readonly top: number;
  readonly bottom: number;
  readonly left: number;
  readonly right: number;
}

/** Sheet rows that moved, and which way. */
export interface Moved {
  readonly top: number;
  readonly bottom: number;
  readonly down: boolean;
}

/** Sheet rows a gap grew by, end-exclusive; `top === bottom` where a gap shrank. */
export interface Gap {
  readonly top: number;
  readonly bottom: number;
}

type Colour = readonly number[];

/** How much of the side's colour a changed area is washed with: enough to find on a phone, little enough to read through. */
const WASH = 0.3;

/** One window: before and after, columns `left` to `right`, side by side. */
export function drawWindow(
  was: DecodedImage,
  now: DecodedImage,
  left: number,
  right: number,
  rows: readonly SheetRow[],
  marks: readonly Mark[],
  moved: readonly Moved[],
  gaps: readonly Gap[] = [],
): DecodedImage {
  const panel = right - left;
  const { stroke, gutter, frame: edge } = changeLayout(panel);
  const width = 2 * panel + gutter;
  const height = rows.length;
  const data = new Uint8Array(width * height * 4);
  const set = (x: number, y: number, colour: Colour) => data.set(colour, (y * width + x) * 4);
  const origin = { before: 0, after: panel + gutter } as const;

  for (let y = 0; y < height; y += 1) for (let x = panel; x < panel + gutter; x += 1) set(x, y, CHANGE_COLOURS.canvas);

  rows.forEach((row, index) => {
    const y = index;
    for (const [side, image, from] of [
      ['before', was, row.before],
      ['after', now, row.after],
    ] as const) {
      const at = origin[side];
      if (from < 0) {
        // Diagonal stripes, so filler is never read as a page's own blank.
        for (let x = 0; x < panel; x += 1) set(at + x, y, CHANGE_COLOURS.filler[Math.floor((x + y) / 4) % 2]!);
        continue;
      }
      // White past the image's right edge, as the comparison padded it.
      data.fill(0xff, (y * width + at) * 4, (y * width + at + panel) * 4);
      const to = Math.min(right, image.width);
      if (to > left) {
        const start = (from * image.width + left) * 4;
        data.set(image.data.subarray(start, start + (to - left) * 4), (y * width + at) * 4);
      }
    }
  });

  const image = { width, height, data };
  for (const mark of marks) {
    // A wash of the side's colour over what changed, the way a code review
    // highlights a changed word, edged by a line of it: an outline thick
    // enough to survive the comment's scaling would cover the next word.
    const at = origin[mark.side];
    const colour = CHANGE_COLOURS[mark.side];
    const top = Math.max(0, mark.top - edge);
    const bottom = Math.min(height, mark.bottom + edge);
    const from = Math.max(0, mark.left - edge);
    const to = Math.min(panel, mark.right + edge);
    for (let y = top; y < bottom; y += 1) {
      for (let x = from; x < to; x += 1) {
        const rim = y - top < edge || bottom - 1 - y < edge || x - from < edge || to - 1 - x < edge;
        blend(image, at + x, y, colour, rim ? 1 : WASH);
      }
    }
  }

  const centre = panel + Math.floor(gutter / 2);
  const reach = Math.floor(gutter / 2) - 2;
  for (const span of moved) {
    // An arrow the height of the rows that moved, its head at the end they
    // moved toward: a shaft as thick as an outline and a solid head.
    const length = span.bottom - span.top;
    const head = Math.min(length, reach + 1);
    const shaft = span.down ? [span.top, span.bottom - head] : [span.top + head, span.bottom];
    for (let y = shaft[0]!; y < shaft[1]!; y += 1) {
      for (let x = centre - Math.floor(stroke / 2); x < centre - Math.floor(stroke / 2) + stroke; x += 1) set(x, y, CHANGE_COLOURS.moved);
    }
    const tip = span.down ? span.bottom : span.top;
    const base = span.down ? span.bottom - head : span.top + head;
    triangle({ width, height, data }, centre + 0.5, tip, base, (reach + 0.5) * (head / (reach + 1)), CHANGE_COLOURS.moved);
  }

  // A dimension line across the gutter at each edge of a gap that grew, joined
  // by the bar, and a single one where a gap shrank: spacing, not content.
  for (const gap of gaps) {
    const dot = (x: number, y: number) => {
      if (y >= 0 && y < rows.length) set(x, y, CHANGE_COLOURS.moved);
    };
    for (const edge of gap.bottom > gap.top ? [gap.top, gap.bottom] : [gap.top]) {
      for (let thick = 0; thick < stroke; thick += 1) {
        for (let x = centre - reach; x <= centre + reach; x += 1) dot(x, edge - Math.floor(stroke / 2) + thick);
      }
    }
    for (let y = gap.top; y < gap.bottom; y += 1) {
      for (let x = centre - Math.floor(stroke / 2); x < centre - Math.floor(stroke / 2) + stroke; x += 1) dot(x, y);
    }
  }

  return { width, height, data };
}

/**
 * The sheet: the windows one under another, every one the same width, on a
 * canvas with a margin all round, each panel framed, under a label per column
 * and, when there is one, the subject's name.
 */
export function composeSheet(windows: readonly DecodedImage[], panel: number, labels: ChangeLabels = {}): DecodedImage {
  const titled = labels.subject !== undefined;
  const { gutter, frame, unit, title, header } = changeLayout(panel, titled);
  const width = 2 * unit + 2 * panel + gutter;
  const height = header + windows.reduce((sum, window) => sum + window.height, 0) + unit * windows.length;
  const data = new Uint8Array(width * height * 4);
  for (let at = 0; at < data.length; at += 4) data.set(CHANGE_COLOURS.canvas, at);
  const sheet = { width, height, data };
  const columns = { before: unit, after: unit + panel + gutter } as const;

  let line = unit;
  if (titled) {
    drawText(sheet, fitText(labels.subject!, title, width - 2 * unit, 'semibold'), unit, line + title * 0.95, title, CHANGE_COLOURS.ink, 'semibold');
    line += Math.round(title * 1.5);
  }
  for (const side of ['before', 'after'] as const) {
    const baseline = line + unit;
    const dot = Math.round(unit * 0.6);
    disc(sheet, columns[side] + dot / 2, baseline - unit * 0.36, dot / 2, CHANGE_COLOURS[side]);
    const name = side === 'before' ? 'Before' : 'After';
    const at = columns[side] + dot + Math.round(unit * 0.45);
    const limit = columns[side] + panel;
    drawText(sheet, name, at, baseline, unit, CHANGE_COLOURS.ink, 'semibold', limit);
    const source = labels[side];
    if (source === undefined) continue;
    const from = at + Math.round(unit * 0.5) + Math.ceil(measureText(name, unit, 'semibold'));
    drawText(sheet, fitText(source, unit, limit - from), from, baseline, unit, CHANGE_COLOURS.muted, 'regular', limit);
  }

  let y = header;
  for (const window of windows) {
    for (let row = 0; row < window.height; row += 1) {
      data.set(window.data.subarray(row * window.width * 4, (row + 1) * window.width * 4), ((y + row) * width + unit) * 4);
    }
    // After the window, which brings its gutter's canvas over the frame's inner edge.
    for (const side of ['before', 'after'] as const) {
      const [left, top, right, bottom] = [columns[side] - frame, y - frame, columns[side] + panel, y + window.height];
      rectangle(sheet, left, top, panel + 2 * frame, frame, CHANGE_COLOURS.frame);
      rectangle(sheet, left, bottom, panel + 2 * frame, frame, CHANGE_COLOURS.frame);
      rectangle(sheet, left, top, frame, window.height + 2 * frame, CHANGE_COLOURS.frame);
      rectangle(sheet, right, top, frame, window.height + 2 * frame, CHANGE_COLOURS.frame);
    }
    y += window.height + unit;
  }
  return sheet;
}

/**
 * A solid triangle pointing up or down: its tip at `(cx, tip)`, its base along
 * row `base`, `half` wide either side of `cx`, smoothed by sampling each pixel
 * four by four.
 */
function triangle(image: DecodedImage, cx: number, tip: number, base: number, half: number, colour: Colour): void {
  const [top, bottom] = tip < base ? [tip, base] : [base, tip];
  for (let y = Math.floor(top); y < Math.ceil(bottom); y += 1) {
    for (let x = Math.floor(cx - half); x <= Math.ceil(cx + half); x += 1) {
      let inside = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        const py = y + (sy + 0.5) / 4;
        if (py < top || py > bottom) continue;
        const reach = (half * Math.abs(py - tip)) / Math.abs(base - tip);
        for (let sx = 0; sx < 4; sx += 1) if (Math.abs(x + (sx + 0.5) / 4 - cx) <= reach) inside += 1;
      }
      blend(image, x, y, colour, inside / 16);
    }
  }
}

function rectangle(image: DecodedImage, left: number, top: number, w: number, h: number, colour: Colour): void {
  for (let y = Math.max(0, top); y < Math.min(image.height, top + h); y += 1) {
    for (let x = Math.max(0, left); x < Math.min(image.width, left + w); x += 1) image.data.set(colour, (y * image.width + x) * 4);
  }
}

/** A filled circle, its edge smoothed by sampling each pixel four by four. */
function disc(image: DecodedImage, cx: number, cy: number, r: number, colour: Colour): void {
  for (let y = Math.floor(cy - r) - 1; y <= Math.ceil(cy + r) + 1; y += 1) {
    for (let x = Math.floor(cx - r) - 1; x <= Math.ceil(cx + r) + 1; x += 1) {
      let inside = 0;
      for (let sy = 0; sy < 4; sy += 1) {
        for (let sx = 0; sx < 4; sx += 1) {
          if ((x + (sx + 0.5) / 4 - cx) ** 2 + (y + (sy + 0.5) / 4 - cy) ** 2 <= r * r) inside += 1;
        }
      }
      blend(image, x, y, colour, inside / 16);
    }
  }
}

function blend(image: DecodedImage, x: number, y: number, colour: Colour, alpha: number): void {
  if (alpha <= 0 || x < 0 || y < 0 || x >= image.width || y >= image.height) return;
  const at = (y * image.width + x) * 4;
  for (let channel = 0; channel < 3; channel += 1) {
    image.data[at + channel] = Math.round(image.data[at + channel]! * (1 - alpha) + colour[channel]! * alpha);
  }
}
