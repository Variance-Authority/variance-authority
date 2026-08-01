/**
 * Colour canonicalization.
 *
 * `red`, `#f00`, `#ff0000`, `rgb(255,0,0)`, `rgb(255 0 0)`, and
 * `hsl(0, 100%, 50%)` all paint identical pixels. Left alone they produce six
 * different hashes, so a stylesheet refactor that swaps hex for a named colour
 * would invalidate every baseline it touches while changing nothing a user sees.
 *
 * Everything sRGB-expressible collapses to `rgb(R G B / A)`. Wide-gamut and
 * relative forms (`oklch`, `color-mix`, `light-dark`) are *not* converted:
 * doing so requires colour-space maths whose rounding would itself become a
 * source of hash instability, and — worse — would silently claim two colours are
 * equal when the engine may render them differently. They are whitespace- and
 * case-normalized only, and left symbolic.
 */

/** Named CSS colours. `transparent` included; `currentcolor` deliberately not. */
const NAMED: Readonly<Record<string, readonly [number, number, number, number]>> = {
  transparent: [0, 0, 0, 0],
  aliceblue: [240, 248, 255, 1], antiquewhite: [250, 235, 215, 1], aqua: [0, 255, 255, 1],
  aquamarine: [127, 255, 212, 1], azure: [240, 255, 255, 1], beige: [245, 245, 220, 1],
  bisque: [255, 228, 196, 1], black: [0, 0, 0, 1], blanchedalmond: [255, 235, 205, 1],
  blue: [0, 0, 255, 1], blueviolet: [138, 43, 226, 1], brown: [165, 42, 42, 1],
  burlywood: [222, 184, 135, 1], cadetblue: [95, 158, 160, 1], chartreuse: [127, 255, 0, 1],
  chocolate: [210, 105, 30, 1], coral: [255, 127, 80, 1], cornflowerblue: [100, 149, 237, 1],
  cornsilk: [255, 248, 220, 1], crimson: [220, 20, 60, 1], cyan: [0, 255, 255, 1],
  darkblue: [0, 0, 139, 1], darkcyan: [0, 139, 139, 1], darkgoldenrod: [184, 134, 11, 1],
  darkgray: [169, 169, 169, 1], darkgreen: [0, 100, 0, 1], darkgrey: [169, 169, 169, 1],
  darkkhaki: [189, 183, 107, 1], darkmagenta: [139, 0, 139, 1], darkolivegreen: [85, 107, 47, 1],
  darkorange: [255, 140, 0, 1], darkorchid: [153, 50, 204, 1], darkred: [139, 0, 0, 1],
  darksalmon: [233, 150, 122, 1], darkseagreen: [143, 188, 143, 1], darkslateblue: [72, 61, 139, 1],
  darkslategray: [47, 79, 79, 1], darkslategrey: [47, 79, 79, 1], darkturquoise: [0, 206, 209, 1],
  darkviolet: [148, 0, 211, 1], deeppink: [255, 20, 147, 1], deepskyblue: [0, 191, 255, 1],
  dimgray: [105, 105, 105, 1], dimgrey: [105, 105, 105, 1], dodgerblue: [30, 144, 255, 1],
  firebrick: [178, 34, 34, 1], floralwhite: [255, 250, 240, 1], forestgreen: [34, 139, 34, 1],
  fuchsia: [255, 0, 255, 1], gainsboro: [220, 220, 220, 1], ghostwhite: [248, 248, 255, 1],
  gold: [255, 215, 0, 1], goldenrod: [218, 165, 32, 1], gray: [128, 128, 128, 1],
  green: [0, 128, 0, 1], greenyellow: [173, 255, 47, 1], grey: [128, 128, 128, 1],
  honeydew: [240, 255, 240, 1], hotpink: [255, 105, 180, 1], indianred: [205, 92, 92, 1],
  indigo: [75, 0, 130, 1], ivory: [255, 255, 240, 1], khaki: [240, 230, 140, 1],
  lavender: [230, 230, 250, 1], lavenderblush: [255, 240, 245, 1], lawngreen: [124, 252, 0, 1],
  lemonchiffon: [255, 250, 205, 1], lightblue: [173, 216, 230, 1], lightcoral: [240, 128, 128, 1],
  lightcyan: [224, 255, 255, 1], lightgoldenrodyellow: [250, 250, 210, 1],
  lightgray: [211, 211, 211, 1], lightgreen: [144, 238, 144, 1], lightgrey: [211, 211, 211, 1],
  lightpink: [255, 182, 193, 1], lightsalmon: [255, 160, 122, 1], lightseagreen: [32, 178, 170, 1],
  lightskyblue: [135, 206, 250, 1], lightslategray: [119, 136, 153, 1],
  lightslategrey: [119, 136, 153, 1], lightsteelblue: [176, 196, 222, 1],
  lightyellow: [255, 255, 224, 1], lime: [0, 255, 0, 1], limegreen: [50, 205, 50, 1],
  linen: [250, 240, 230, 1], magenta: [255, 0, 255, 1], maroon: [128, 0, 0, 1],
  mediumaquamarine: [102, 205, 170, 1], mediumblue: [0, 0, 205, 1],
  mediumorchid: [186, 85, 211, 1], mediumpurple: [147, 112, 219, 1],
  mediumseagreen: [60, 179, 113, 1], mediumslateblue: [123, 104, 238, 1],
  mediumspringgreen: [0, 250, 154, 1], mediumturquoise: [72, 209, 204, 1],
  mediumvioletred: [199, 21, 133, 1], midnightblue: [25, 25, 112, 1], mintcream: [245, 255, 250, 1],
  mistyrose: [255, 228, 225, 1], moccasin: [255, 228, 181, 1], navajowhite: [255, 222, 173, 1],
  navy: [0, 0, 128, 1], oldlace: [253, 245, 230, 1], olive: [128, 128, 0, 1],
  olivedrab: [107, 142, 35, 1], orange: [255, 165, 0, 1], orangered: [255, 69, 0, 1],
  orchid: [218, 112, 214, 1], palegoldenrod: [238, 232, 170, 1], palegreen: [152, 251, 152, 1],
  paleturquoise: [175, 238, 238, 1], palevioletred: [219, 112, 147, 1],
  papayawhip: [255, 239, 213, 1], peachpuff: [255, 218, 185, 1], peru: [205, 133, 63, 1],
  pink: [255, 192, 203, 1], plum: [221, 160, 221, 1], powderblue: [176, 224, 230, 1],
  purple: [128, 0, 128, 1], rebeccapurple: [102, 51, 153, 1], red: [255, 0, 0, 1],
  rosybrown: [188, 143, 143, 1], royalblue: [65, 105, 225, 1], saddlebrown: [139, 69, 19, 1],
  salmon: [250, 128, 114, 1], sandybrown: [244, 164, 96, 1], seagreen: [46, 139, 87, 1],
  seashell: [255, 245, 238, 1], sienna: [160, 82, 45, 1], silver: [192, 192, 192, 1],
  skyblue: [135, 206, 235, 1], slateblue: [106, 90, 205, 1], slategray: [112, 128, 144, 1],
  slategrey: [112, 128, 144, 1], snow: [255, 250, 250, 1], springgreen: [0, 255, 127, 1],
  steelblue: [70, 130, 180, 1], tan: [210, 180, 140, 1], teal: [0, 128, 128, 1],
  thistle: [216, 191, 216, 1], tomato: [255, 99, 71, 1], turquoise: [64, 224, 208, 1],
  violet: [238, 130, 238, 1], wheat: [245, 222, 179, 1], white: [255, 255, 255, 1],
  whitesmoke: [245, 245, 245, 1], yellow: [255, 255, 0, 1], yellowgreen: [154, 205, 50, 1],
};

export type Rgba = readonly [number, number, number, number];

/** Parse any sRGB-expressible colour. Returns `null` for anything else. */
export function parseColor(input: string): Rgba | null {
  const value = input.trim().toLowerCase();

  const named = NAMED[value];
  if (named) return named;

  if (value.startsWith('#')) return parseHex(value);
  if (value.startsWith('rgb')) return parseRgbFunction(value);
  if (value.startsWith('hsl')) return parseHslFunction(value);

  return null;
}

/**
 * Serialize to the single canonical form: `rgb(R G B / A)`.
 *
 * Channels are integers; alpha keeps three decimals, enough to distinguish every
 * 8-bit alpha step while discarding float noise from `hsl` conversion.
 */
export function formatColor([r, g, b, a]: Rgba): string {
  const channels = `${clampChannel(r)} ${clampChannel(g)} ${clampChannel(b)}`;
  const alpha = Math.round(clamp(a, 0, 1) * 1000) / 1000;
  return `rgb(${channels} / ${alpha})`;
}

/** Canonicalize if recognizable; otherwise normalize whitespace and case only. */
export function canonicalizeColor(input: string): string {
  const parsed = parseColor(input);
  return parsed ? formatColor(parsed) : collapseWhitespace(input);
}

/** Whether a property's value should be read as a colour. */
export function isColorProperty(property: string): boolean {
  return (
    property === 'color' ||
    property.endsWith('-color') ||
    property === 'background-color' ||
    property === 'caret-color'
  );
}

function parseHex(value: string): Rgba | null {
  const hex = value.slice(1);
  const expand = (c: string): number => Number.parseInt(c + c, 16);
  const pair = (i: number): number => Number.parseInt(hex.slice(i, i + 2), 16);

  switch (hex.length) {
    case 3:
      return [expand(hex[0]!), expand(hex[1]!), expand(hex[2]!), 1];
    case 4:
      return [expand(hex[0]!), expand(hex[1]!), expand(hex[2]!), expand(hex[3]!) / 255];
    case 6:
      return [pair(0), pair(2), pair(4), 1];
    case 8:
      return [pair(0), pair(2), pair(4), pair(6) / 255];
    default:
      return null;
  }
}

/**
 * Accepts both the legacy comma syntax and the modern space syntax, which are
 * the same colour written two ways — a distinction no renderer preserves and no
 * baseline should record.
 */
function parseRgbFunction(value: string): Rgba | null {
  const args = functionArguments(value);
  if (!args || args.length < 3) return null;

  const channel = (raw: string): number =>
    raw.endsWith('%') ? (Number.parseFloat(raw) / 100) * 255 : Number.parseFloat(raw);

  const r = channel(args[0]!);
  const g = channel(args[1]!);
  const b = channel(args[2]!);
  const a = args.length > 3 ? parseAlpha(args[3]!) : 1;

  return [r, g, b, a].some(Number.isNaN) ? null : [Math.round(r), Math.round(g), Math.round(b), a];
}

function parseHslFunction(value: string): Rgba | null {
  const args = functionArguments(value);
  if (!args || args.length < 3) return null;

  const h = ((Number.parseFloat(args[0]!) % 360) + 360) % 360;
  const s = Number.parseFloat(args[1]!) / 100;
  const l = Number.parseFloat(args[2]!) / 100;
  const a = args.length > 3 ? parseAlpha(args[3]!) : 1;
  if ([h, s, l, a].some(Number.isNaN)) return null;

  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = l - c / 2;
  const sextant = Math.floor(h / 60) % 6;
  const rgb: readonly (readonly [number, number, number])[] = [
    [c, x, 0], [x, c, 0], [0, c, x], [0, x, c], [x, 0, c], [c, 0, x],
  ];
  const [r, g, b] = rgb[sextant]!;

  return [Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255), a];
}

function parseAlpha(raw: string): number {
  return raw.endsWith('%') ? Number.parseFloat(raw) / 100 : Number.parseFloat(raw);
}

/** Split `fn(a, b c / d)` into `['a','b','c','d']`, tolerating both separators. */
function functionArguments(value: string): string[] | null {
  const open = value.indexOf('(');
  const close = value.lastIndexOf(')');
  if (open < 0 || close < open) return null;

  return value
    .slice(open + 1, close)
    .split(/[\s,/]+/)
    .filter((part) => part.length > 0);
}

function clampChannel(value: number): number {
  return Math.round(clamp(value, 0, 255));
}

function clamp(value: number, min: number, max: number): number {
  return value < min ? min : value > max ? max : value;
}

function collapseWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}
