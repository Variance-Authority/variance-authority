import { canonicalizeColor, isColorProperty } from './color.js';

/**
 * Declaration-value canonicalization.
 *
 * Every value entering a snapshot passes through here. The job is to erase every
 * way CSS lets an author write the same thing differently — spacing, casing,
 * absolute unit choice, float formatting — so that reformatting a stylesheet is
 * not a mass-invalidation event.
 *
 * The discipline is one-directional: collapse only differences that provably
 * cannot reach a pixel. Anything that *might* render differently is left alone,
 * because an over-eager equivalence here produces a false `unchanged`, and the
 * cost of the opposite mistake is only a review that did not need to happen.
 */

/** Absolute lengths, in CSS px. Fixed by spec, so conversion is lossless. */
const ABSOLUTE_LENGTHS: Readonly<Record<string, number>> = {
  px: 1,
  pt: 96 / 72,
  pc: 16,
  in: 96,
  cm: 96 / 2.54,
  mm: 96 / 25.4,
  q: 96 / 101.6,
};

/** Angles, in degrees. */
const ANGLES: Readonly<Record<string, number>> = {
  deg: 1,
  grad: 0.9,
  rad: 180 / Math.PI,
  turn: 360,
};

/**
 * Units left symbolic because they cannot be resolved without a layout engine.
 *
 * This is the `declared-only` boundary made concrete (ADR-0002): under a profile
 * without computed style, `padding: 1rem` stays `1rem`. That is honest — it is
 * genuinely all that tier knows — and it is why JSDOM decides the token band
 * `declared-only` rather than `full`. Resolving these by assuming a root font
 * size would fabricate precision the tier does not have.
 */
export const RELATIVE_UNITS: readonly string[] = [
  'em', 'rem', 'ex', 'ch', 'cap', 'ic', 'lh', 'rlh',
  'vw', 'vh', 'vmin', 'vmax', 'vi', 'vb',
  'svw', 'svh', 'lvw', 'lvh', 'dvw', 'dvh', '%',
];

/** Decimal places kept for a length. Absorbs float noise, keeps sub-pixel intent. */
const LENGTH_PRECISION = 4;

export function canonicalizeValue(property: string, value: string): string {
  if (isColorProperty(property)) return canonicalizeColor(value);
  return canonicalizeTokens(value);
}

/**
 * Rewrite a value token by token.
 *
 * Quoted strings and `url()` payloads are passed through untouched: a font
 * family name and a resource path are opaque data, and normalizing their case
 * would change what they refer to.
 */
export function canonicalizeTokens(value: string): string {
  const out: string[] = [];
  let index = 0;
  const input = value.trim();

  while (index < input.length) {
    const char = input[index]!;

    if (/\s/.test(char)) {
      if (out.length > 0 && out[out.length - 1] !== ' ') out.push(' ');
      index += 1;
      continue;
    }

    if (char === '"' || char === "'") {
      const end = closingQuote(input, index);
      out.push(input.slice(index, end + 1));
      index = end + 1;
      continue;
    }

    if (input.slice(index).toLowerCase().startsWith('url(')) {
      const end = matchingParen(input, index + 3);
      out.push(`url${input.slice(index + 3, end + 1)}`);
      index = end + 1;
      continue;
    }

    const numeric = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?([a-z%]*)/i.exec(input.slice(index));
    if (numeric && numeric[0].length > 0) {
      out.push(canonicalizeDimension(numeric[0]));
      index += numeric[0].length;
      continue;
    }

    const identifier = /^[a-z_-][\w-]*/i.exec(input.slice(index));
    if (identifier) {
      // Unquoted identifiers are CSS keywords and function names, both
      // case-insensitive to the parser and therefore safe to fold.
      out.push(identifier[0].toLowerCase());
      index += identifier[0].length;
      continue;
    }

    // Punctuation: `,` `(` `)` `/` `*`. Drop whitespace before a comma so
    // `a , b` and `a, b` converge.
    if (char === ',' && out[out.length - 1] === ' ') out.pop();
    out.push(char);
    index += 1;
  }

  return out.join('').trim();
}

/** Canonicalize one `<number><unit>` token. */
export function canonicalizeDimension(token: string): string {
  const match = /^([+-]?(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?)([a-z%]*)$/i.exec(token);
  if (!match) return token.toLowerCase();

  const magnitude = Number.parseFloat(match[1]!);
  const unit = match[2]!.toLowerCase();

  if (!Number.isFinite(magnitude)) return token.toLowerCase();

  // A zero length is unitless per spec, and `0`, `0px`, `0em` are the same
  // declaration written three ways.
  if (magnitude === 0 && (unit === '' || unit in ABSOLUTE_LENGTHS || isRelativeUnit(unit))) {
    return '0';
  }

  const lengthFactor = ABSOLUTE_LENGTHS[unit];
  if (lengthFactor !== undefined) return `${round(magnitude * lengthFactor)}px`;

  const angleFactor = ANGLES[unit];
  if (angleFactor !== undefined) return `${round(magnitude * angleFactor)}deg`;

  return `${round(magnitude)}${unit}`;
}

export function isRelativeUnit(unit: string): boolean {
  return RELATIVE_UNITS.includes(unit.toLowerCase());
}

/** Whether a value still depends on something only a layout engine can supply. */
export function isUnresolved(value: string): boolean {
  return /(?:^|[\s(,])[+-]?(?:\d+\.?\d*|\.\d+)(em|rem|ex|ch|lh|v[whib]|vmin|vmax|%)\b/i.test(value);
}

function round(value: number): number {
  const factor = 10 ** LENGTH_PRECISION;
  const rounded = Math.round(value * factor) / factor;
  return Object.is(rounded, -0) ? 0 : rounded;
}

function closingQuote(input: string, start: number): number {
  const quote = input[start];
  for (let i = start + 1; i < input.length; i += 1) {
    if (input[i] === '\\') {
      i += 1;
      continue;
    }
    if (input[i] === quote) return i;
  }
  return input.length - 1;
}

function matchingParen(input: string, openIndex: number): number {
  let depth = 0;
  for (let i = openIndex; i < input.length; i += 1) {
    if (input[i] === '(') depth += 1;
    else if (input[i] === ')') {
      depth -= 1;
      if (depth === 0) return i;
    }
  }
  return input.length - 1;
}
