import type { DecodedImage } from './mask.js';

/**
 * The pixels of one change sheet: before beside after, outlined where they
 * changed, with a gutter between them that says which rows only moved.
 *
 * `change.ts` decides what is shown; this draws it. Nothing here reads an
 * alignment or a region, only rows, rectangles and colours.
 */

/** The colours of the sheet, exported so a test can find each part of it. */
export const CHANGE_COLOURS = {
  /** The before panel's header and outlines. */
  before: [0xcf, 0x22, 0x2e, 0xff],
  /** The after panel's header and outlines. */
  after: [0x1a, 0x7f, 0x37, 0xff],
  /** Either side of an outline, so it reads on a dark page and on a light one. */
  ring: [0xff, 0xff, 0xff, 0xff],
  /** The gutter's mark beside rows that moved and did not change. */
  moved: [0x09, 0x69, 0xda, 0xff],
  /** The gutter itself. */
  gutter: [0xf6, 0xf8, 0xfa, 0xff],
  /** The stripes opposite rows the other side does not have. */
  filler: [
    [0xea, 0xee, 0xf2, 0xff],
    [0xd0, 0xd7, 0xde, 0xff],
  ],
} as const;

/**
 * The sizes of a sheet whose panels are `panel` pixels wide.
 *
 * The comment column scales a wide sheet down, so the outline and the gutter
 * grow with the crop: at 1280 a two-pixel line would vanish on a phone.
 */
export function changeLayout(panel: number): { stroke: number; header: number; gutter: number } {
  const stroke = Math.max(2, Math.ceil(panel / 120));
  return { stroke, header: Math.max(4, 2 * stroke), gutter: 4 * stroke + 4 };
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

/** Before and after, columns `left` to `right`, side by side under their headers. */
export function drawSheet(
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
  const { stroke, header, gutter } = changeLayout(panel);
  const width = 2 * panel + gutter;
  const height = header + rows.length;
  const data = new Uint8Array(width * height * 4);
  const set = (x: number, y: number, colour: Colour) => data.set(colour, (y * width + x) * 4);
  const origin = { before: 0, after: panel + gutter } as const;

  for (let y = 0; y < height; y += 1) for (let x = panel; x < panel + gutter; x += 1) set(x, y, CHANGE_COLOURS.gutter);
  for (let y = 0; y < header; y += 1) {
    for (let x = 0; x < panel; x += 1) {
      set(origin.before + x, y, CHANGE_COLOURS.before);
      set(origin.after + x, y, CHANGE_COLOURS.after);
    }
  }

  rows.forEach((row, index) => {
    const y = header + index;
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

  for (const mark of marks) {
    const at = origin[mark.side];
    // A white ring, the colour, a white ring, just outside the rectangle: the
    // changed pixels themselves are never painted over.
    const colours: Colour[] = [CHANGE_COLOURS.ring, ...Array<Colour>(stroke).fill(CHANGE_COLOURS[mark.side]), CHANGE_COLOURS.ring];
    colours.forEach((colour, ring) => {
      const d = ring + 1;
      const top = mark.top - d;
      const bottom = mark.bottom - 1 + d;
      const from = mark.left - d;
      const to = mark.right - 1 + d;
      const dot = (x: number, y: number) => {
        if (x >= 0 && x < panel && y >= 0 && y < rows.length) set(at + x, header + y, colour);
      };
      for (let x = from; x <= to; x += 1) {
        dot(x, top);
        dot(x, bottom);
      }
      for (let y = top; y <= bottom; y += 1) {
        dot(from, y);
        dot(to, y);
      }
    });
  }

  const centre = panel + Math.floor(gutter / 2);
  const reach = Math.floor(gutter / 2) - 2;
  for (const span of moved) {
    const dot = (x: number, y: number) => {
      if (y >= span.top && y < span.bottom) set(x, header + y, CHANGE_COLOURS.moved);
    };
    // A bar the height of the rows that moved, and a chevron every few rows
    // pointing the way they went.
    for (let y = span.top; y < span.bottom; y += 1) {
      for (let x = centre - Math.floor(stroke / 2); x < centre - Math.floor(stroke / 2) + stroke; x += 1) dot(x, y);
    }
    const every = 6 * gutter;
    for (let tip = span.top + Math.min(every / 2, (span.bottom - span.top) >> 1); tip < span.bottom; tip += every) {
      for (let step = 0; step <= reach; step += 1) {
        for (let thick = 0; thick < stroke; thick += 1) {
          const y = span.down ? tip - step - thick : tip + step + thick;
          dot(centre - step, y);
          dot(centre + step, y);
        }
      }
    }
  }

  // A dimension line across the gutter at each edge of a gap that grew, joined
  // by the bar, and a single one where a gap shrank: spacing, not content.
  for (const gap of gaps) {
    const dot = (x: number, y: number) => {
      if (y >= 0 && y < rows.length) set(x, header + y, CHANGE_COLOURS.moved);
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
