import { readFileSync } from 'node:fs';
import { PNG } from 'pngjs';
import type { DecodedImage } from './mask.js';

/**
 * Text on a decoded image, without a browser: what the change image labels
 * itself with.
 *
 * The glyphs are Inter, drawn once by `tools/glyph-atlas.mjs` at 64 pixels into
 * `glyphs/`, and scaled down here by area, so a label keeps the face's own
 * anti-aliasing at any size up to that. Inter is under the SIL Open Font
 * License 1.1, in `glyphs/inter-LICENSE.txt`.
 */

export type Weight = 'regular' | 'semibold';

interface Face {
  readonly size: number;
  readonly height: number;
  readonly ascent: number;
  readonly pad: number;
  readonly width: number;
  readonly coverage: Uint8Array;
  readonly glyphs: Readonly<Record<string, readonly [x: number, width: number, advance: number]>>;
}

interface Metrics {
  readonly size: number;
  readonly pad: number;
  readonly weights: Record<Weight, { height: number; ascent: number; glyphs: Face['glyphs'] }>;
}

const faces = new Map<Weight, Face>();

function face(weight: Weight): Face {
  const known = faces.get(weight);
  if (known !== undefined) return known;
  const metrics = JSON.parse(readFileSync(new URL('../glyphs/inter.json', import.meta.url), 'utf8')) as Metrics;
  const png = PNG.sync.read(readFileSync(new URL(`../glyphs/inter-${weight}.png`, import.meta.url)));
  // pngjs hands back RGBA whatever the file held; the grey value is coverage.
  const coverage = new Uint8Array(png.width * png.height);
  for (let at = 0; at < coverage.length; at += 1) coverage[at] = png.data[at * 4]!;
  const own = metrics.weights[weight];
  const made: Face = { ...own, size: metrics.size, pad: metrics.pad, width: png.width, coverage };
  faces.set(weight, made);
  return made;
}

/** A character the atlas holds, or `?` in its place. */
function glyphOf(font: Face, character: string): Face['glyphs'][string] {
  return font.glyphs[character] ?? font.glyphs['?']!;
}

/** How wide `text` sets at `size` pixels. */
export function measureText(text: string, size: number, weight: Weight = 'regular'): number {
  const font = face(weight);
  let advance = 0;
  for (const character of text) advance += glyphOf(font, character)[2];
  return (advance * size) / font.size;
}

/** `text`, cut with an ellipsis where it would set wider than `width`. */
export function fitText(text: string, size: number, width: number, weight: Weight = 'regular'): string {
  if (measureText(text, size, weight) <= width) return text;
  const characters = [...text];
  while (characters.length > 0 && measureText(`${characters.join('')}…`, size, weight) > width) characters.pop();
  return characters.length === 0 ? '' : `${characters.join('')}…`;
}

/**
 * Sets `text` on `image` with its baseline at `baseline` and its left edge at
 * `x`, `size` pixels to the em, in `colour`, clipped to columns `x` to `limit`.
 */
export function drawText(
  image: DecodedImage,
  text: string,
  x: number,
  baseline: number,
  size: number,
  colour: readonly number[],
  weight: Weight = 'regular',
  limit = image.width,
): void {
  const font = face(weight);
  const scale = Math.min(1, size / font.size);
  const rows = Math.ceil(font.height * scale) + 1;
  const top = baseline - font.ascent * scale;
  let pen = x;
  for (const character of text) {
    const [from, width, advance] = glyphOf(font, character);
    // The cell starts `pad` atlas pixels left of the pen; where it lands
    // between two image pixels is kept, so spacing does not round per glyph.
    const left = pen - font.pad * scale;
    const columns = Math.ceil(width * scale) + 2;
    const originX = Math.floor(left);
    const originY = Math.floor(top);
    for (let dy = 0; dy < rows; dy += 1) {
      const y = originY + dy;
      if (y < 0 || y >= image.height) continue;
      for (let dx = 0; dx < columns; dx += 1) {
        const px = originX + dx;
        if (px < 0 || px >= Math.min(limit, image.width)) continue;
        const cover = area(font, from, width, (px - left) / scale, (px + 1 - left) / scale, (y - top) / scale, (y + 1 - top) / scale);
        if (cover <= 0) continue;
        blend(image, px, y, colour, cover);
      }
    }
    pen += advance * scale;
  }
}

/** The mean coverage of atlas cell `from`..`from + width` over the rectangle `x0..x1` by `y0..y1`, in cell pixels. */
function area(font: Face, from: number, width: number, x0: number, x1: number, y0: number, y1: number): number {
  let sum = 0;
  for (let y = Math.max(0, Math.floor(y0)); y < Math.min(font.height, Math.ceil(y1)); y += 1) {
    const h = Math.min(y + 1, y1) - Math.max(y, y0);
    if (h <= 0) continue;
    for (let x = Math.max(0, Math.floor(x0)); x < Math.min(width, Math.ceil(x1)); x += 1) {
      const w = Math.min(x + 1, x1) - Math.max(x, x0);
      if (w <= 0) continue;
      sum += font.coverage[y * font.width + from + x]! * w * h;
    }
  }
  return sum / (255 * (x1 - x0) * (y1 - y0));
}

function blend(image: DecodedImage, x: number, y: number, colour: readonly number[], cover: number): void {
  const at = (y * image.width + x) * 4;
  const alpha = Math.min(1, cover) * ((colour[3] ?? 255) / 255);
  for (let channel = 0; channel < 3; channel += 1) {
    image.data[at + channel] = Math.round(image.data[at + channel]! * (1 - alpha) + colour[channel]! * alpha);
  }
  image.data[at + 3] = 0xff;
}
