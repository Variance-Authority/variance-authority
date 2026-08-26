import type { Rect } from '@variance-authority/core';

export const round = (value: number, places = 3): number => {
  const scale = 10 ** places;
  return Math.round(value * scale) / scale;
};

export const codeUnitCompare = (left: string, right: string): number =>
  left < right ? -1 : left > right ? 1 : 0;

export function median(values: readonly number[]): number | undefined {
  if (values.length === 0) return undefined;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

export function numeric(value: string | undefined): number | undefined {
  if (value === undefined) return undefined;
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : undefined;
}

interface Color {
  readonly red: number;
  readonly green: number;
  readonly blue: number;
  readonly alpha: number;
}

export function colorOf(value: string | undefined): Color | undefined {
  if (value === undefined || value === 'transparent') return undefined;
  const components = value.match(/[\d.]+/g)?.map(Number);
  if (components === undefined || components.length < 3) return undefined;
  const [red, green, blue, alpha = 1] = components;
  if (red === undefined || green === undefined || blue === undefined) return undefined;
  return { red, green, blue, alpha };
}

export function opaque(value: string | undefined): string | undefined {
  const color = colorOf(value);
  return color !== undefined && color.alpha > 0.01 ? value : undefined;
}

/** CIE76 distance after sRGB → Lab. Useful as boundary evidence, not WCAG contrast. */
export function perceptualDifference(left: string, right: string): number | undefined {
  const a = colorOf(left);
  const b = colorOf(right);
  if (a === undefined || b === undefined) return undefined;
  const [l1, a1, b1] = lab(a);
  const [l2, a2, b2] = lab(b);
  return round(Math.hypot(l1 - l2, a1 - a2, b1 - b2), 2);
}

export function luminance(value: string | undefined): number | undefined {
  const color = colorOf(value);
  if (color === undefined) return undefined;
  const channel = (part: number): number => {
    const scaled = part / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  return round(channel(color.red) * 0.2126 + channel(color.green) * 0.7152 + channel(color.blue) * 0.0722);
}

function lab(color: Color): readonly [number, number, number] {
  const linear = (part: number): number => {
    const scaled = part / 255;
    return scaled <= 0.04045 ? scaled / 12.92 : ((scaled + 0.055) / 1.055) ** 2.4;
  };
  const red = linear(color.red);
  const green = linear(color.green);
  const blue = linear(color.blue);
  const x = (red * 0.4124 + green * 0.3576 + blue * 0.1805) / 0.95047;
  const y = (red * 0.2126 + green * 0.7152 + blue * 0.0722) / 1;
  const z = (red * 0.0193 + green * 0.1192 + blue * 0.9505) / 1.08883;
  const curve = (part: number): number =>
    part > 0.008856 ? Math.cbrt(part) : 7.787 * part + 16 / 116;
  const fx = curve(x);
  const fy = curve(y);
  const fz = curve(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

export function gapBetween(left: Rect, right: Rect): {
  readonly axis: 'horizontal' | 'vertical' | 'overlap';
  readonly distance: number;
} {
  const horizontal = Math.max(left.x, right.x) - Math.min(left.x + left.width, right.x + right.width);
  const vertical = Math.max(left.y, right.y) - Math.min(left.y + left.height, right.y + right.height);
  if (vertical >= 0 && vertical >= horizontal) return { axis: 'vertical', distance: round(vertical, 2) };
  if (horizontal >= 0) return { axis: 'horizontal', distance: round(horizontal, 2) };
  return { axis: 'overlap', distance: 0 };
}

export function unionArea(rects: readonly Rect[]): number {
  const usable = rects.filter((rect) => rect.width > 0 && rect.height > 0);
  const xs = [...new Set(usable.flatMap((rect) => [rect.x, rect.x + rect.width]))].sort((a, b) => a - b);
  let area = 0;
  for (let index = 0; index < xs.length - 1; index += 1) {
    const from = xs[index]!;
    const to = xs[index + 1]!;
    if (to <= from) continue;
    const spans = usable
      .filter((rect) => rect.x < to && rect.x + rect.width > from)
      .map((rect) => [rect.y, rect.y + rect.height] as const)
      .sort((a, b) => a[0] - b[0]);
    let covered = 0;
    let start: number | undefined;
    let end: number | undefined;
    for (const [nextStart, nextEnd] of spans) {
      if (start === undefined || end === undefined) {
        start = nextStart;
        end = nextEnd;
      } else if (nextStart > end) {
        covered += end - start;
        start = nextStart;
        end = nextEnd;
      } else {
        end = Math.max(end, nextEnd);
      }
    }
    if (start !== undefined && end !== undefined) covered += end - start;
    area += (to - from) * covered;
  }
  return round(area, 2);
}

export function stableEntries(value: Readonly<Record<string, unknown>>): string {
  return Object.keys(value)
    .sort()
    .map((key) => `${key}:${String(value[key])}`)
    .join('|');
}
