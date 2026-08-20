import { parseColor } from './color.js';

/**
 * Shorthand expansion.
 *
 * The allowlist holds longhands only, so `margin: 4px` and
 * `margin-top: 4px; margin-right: 4px; …` must reduce to the same snapshot.
 * Without that, splitting a shorthand during a refactor — a change no user can
 * perceive — would invalidate every baseline it touches.
 *
 * The safety rule throughout: **an expansion we are not sure of is not
 * performed.** {@link expandDeclaration} returns `confident: false` and hands
 * back the shorthand unchanged, which the projection step then admits under its
 * own name. A partially-expanded shorthand would drop the components it failed
 * to classify, and a dropped declaration is a value missing from the hash — a
 * false `unchanged`. Keeping an un-normalized value costs at most a review
 * nobody needed; dropping one costs a missed regression.
 */

export interface Expansion {
  readonly declarations: readonly { readonly property: string; readonly value: string }[];
  /**
   * `false` when the shorthand could not be decomposed with certainty. The
   * single returned declaration is then the original shorthand.
   */
  readonly confident: boolean;
}

/** Shorthands admitted under their own name when expansion is not confident. */
export const SHORTHAND_PROPERTIES: readonly string[] = [
  'margin', 'padding', 'inset', 'gap', 'overflow',
  'border', 'border-width', 'border-style', 'border-color', 'border-radius',
  'border-top', 'border-right', 'border-bottom', 'border-left',
  'outline', 'flex', 'flex-flow', 'place-items', 'place-content', 'place-self',
  'grid-row', 'grid-column', 'grid-area', 'text-decoration', 'background', 'font',
];

const SIDES = ['top', 'right', 'bottom', 'left'] as const;

const CORNERS = [
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
] as const;

const LINE_STYLES = new Set([
  'none', 'hidden', 'dotted', 'dashed', 'solid', 'double',
  'groove', 'ridge', 'inset', 'outset',
]);

const LINE_WIDTHS = new Set(['thin', 'medium', 'thick']);

export function expandDeclaration(property: string, value: string): Expansion {
  const expand = EXPANDERS[property];
  if (!expand) return { declarations: [{ property, value }], confident: true };

  const expanded = expand(value.trim());
  return expanded ?? { declarations: [{ property, value }], confident: false };
}

type Expander = (value: string) => Expansion | null;

const EXPANDERS: Readonly<Record<string, Expander>> = {
  margin: (v) => box(v, (side) => `margin-${side}`),
  padding: (v) => box(v, (side) => `padding-${side}`),
  inset: (v) => box(v, (side) => side),
  'border-width': (v) => box(v, (side) => `border-${side}-width`),
  'border-style': (v) => box(v, (side) => `border-${side}-style`),
  'border-color': (v) => box(v, (side) => `border-${side}-color`),
  'scroll-margin': (v) => box(v, (side) => `scroll-margin-${side}`),
  'scroll-padding': (v) => box(v, (side) => `scroll-padding-${side}`),

  gap: (v) => pair(v, 'row-gap', 'column-gap'),
  overflow: (v) => pair(v, 'overflow-x', 'overflow-y'),
  'place-items': (v) => pair(v, 'align-items', 'justify-items'),
  'place-content': (v) => pair(v, 'align-content', 'justify-content'),
  'place-self': (v) => pair(v, 'align-self', 'justify-self'),

  'grid-row': (v) => slash(v, 'grid-row-start', 'grid-row-end'),
  'grid-column': (v) => slash(v, 'grid-column-start', 'grid-column-end'),

  'border-radius': expandBorderRadius,
  border: (v) => expandBorderSides(v, SIDES),
  'border-top': (v) => expandBorderSides(v, ['top']),
  'border-right': (v) => expandBorderSides(v, ['right']),
  'border-bottom': (v) => expandBorderSides(v, ['bottom']),
  'border-left': (v) => expandBorderSides(v, ['left']),
  outline: expandOutline,
  flex: expandFlex,
  'flex-flow': expandFlexFlow,
  'text-decoration': expandTextDecoration,

  // `background` and `font` are the two shorthands whose grammars are genuinely
  // ambiguous to decompose (a bare `<length>` in `background` may be a position
  // or a size; `font` interleaves four optional keyword slots before a required
  // size). Both are declared unexpandable rather than guessed at — see the
  // safety rule above. Under a profile with computed style the engine has
  // already resolved them into longhands, so this only affects the declared-only
  // tier, where an un-normalized value is a correct description of what is known.
  background: () => null,
  font: () => null,
};

/** 1–4 values in top/right/bottom/left order, per the CSS box grammar. */
function box(value: string, name: (side: string) => string): Expansion | null {
  const parts = topLevelParts(value);
  if (parts.length === 0 || parts.length > 4) return null;
  if (parts.some(isGlobalKeywordAmbiguity)) return null;

  const [a, b = a, c = a, d = b] = parts as [string, string?, string?, string?];
  const resolved = [a, b, c, d] as const;

  return {
    declarations: SIDES.map((side, index) => ({
      property: name(side),
      value: resolved[index]!,
    })),
    confident: true,
  };
}

function pair(value: string, first: string, second: string): Expansion | null {
  const parts = topLevelParts(value);
  if (parts.length === 0 || parts.length > 2) return null;

  const a = parts[0]!;
  const b = parts[1] ?? a;
  return {
    declarations: [
      { property: first, value: a },
      { property: second, value: b },
    ],
    confident: true,
  };
}

function slash(value: string, start: string, end: string): Expansion | null {
  const parts = value.split('/').map((part) => part.trim());
  if (parts.length > 2) return null;

  const a = parts[0]!;
  // Omitted end defaults to `auto`, not to a copy of start, except for a
  // custom-ident line name — where it does copy. Ambiguous, so decline.
  if (parts.length === 1) {
    if (/^-?[a-z_]/i.test(a) && !/^(auto|span)\b/i.test(a)) return null;
    return {
      declarations: [
        { property: start, value: a },
        { property: end, value: 'auto' },
      ],
      confident: true,
    };
  }

  return {
    declarations: [
      { property: start, value: a },
      { property: end, value: parts[1]! },
    ],
    confident: true,
  };
}

/** `border-radius: a b / c d` — the `/` separates horizontal from vertical radii. */
function expandBorderRadius(value: string): Expansion | null {
  const [horizontal, vertical] = value.split('/').map((part) => part.trim());

  const h = cornerValues(horizontal ?? '');
  if (!h) return null;

  if (vertical === undefined) {
    return {
      declarations: CORNERS.map((property, index) => ({ property, value: h[index]! })),
      confident: true,
    };
  }

  const v = cornerValues(vertical);
  if (!v) return null;

  return {
    declarations: CORNERS.map((property, index) => ({
      property,
      value: `${h[index]!} ${v[index]!}`,
    })),
    confident: true,
  };
}

/** Corner order is TL, TR, BR, BL — different from the box order. */
function cornerValues(value: string): readonly [string, string, string, string] | null {
  const parts = topLevelParts(value);
  if (parts.length === 0 || parts.length > 4) return null;

  const [a, b = a, c = a, d = b] = parts as [string, string?, string?, string?];
  return [a, b, c, d];
}

function expandBorderSides(value: string, sides: readonly string[]): Expansion | null {
  const parsed = classifyLineComponents(value);
  if (!parsed) return null;

  const declarations = sides.flatMap((side) => [
    { property: `border-${side}-width`, value: parsed.width },
    { property: `border-${side}-style`, value: parsed.style },
    { property: `border-${side}-color`, value: parsed.color },
  ]);

  return { declarations, confident: true };
}

function expandOutline(value: string): Expansion | null {
  const parsed = classifyLineComponents(value);
  if (!parsed) return null;

  return {
    declarations: [
      { property: 'outline-width', value: parsed.width },
      { property: 'outline-style', value: parsed.style },
      { property: 'outline-color', value: parsed.color },
    ],
    confident: true,
  };
}

/**
 * Split `<width> || <style> || <color>`, which may appear in any order.
 *
 * Omitted components take their initial values rather than being left out —
 * `border: solid` really does reset width and colour, and recording only the
 * style would let a genuine colour change slip through as unobserved.
 */
function classifyLineComponents(
  value: string,
): { width: string; style: string; color: string } | null {
  const parts = topLevelParts(value);
  if (parts.length === 0 || parts.length > 3) return null;

  let width: string | undefined;
  let style: string | undefined;
  let color: string | undefined;

  for (const part of parts) {
    const lower = part.toLowerCase();

    if (LINE_STYLES.has(lower)) {
      if (style !== undefined) return null;
      style = lower;
    } else if (LINE_WIDTHS.has(lower) || isLength(part)) {
      if (width !== undefined) return null;
      width = part;
    } else if (lower === 'currentcolor' || parseColor(part) !== null || part.startsWith('var(')) {
      if (color !== undefined) return null;
      color = part;
    } else {
      return null;
    }
  }

  return {
    width: width ?? 'medium',
    style: style ?? 'none',
    color: color ?? 'currentcolor',
  };
}

/** `flex: <grow> <shrink>? <basis>?`, plus the `none`/`auto`/`initial` keywords. */
function expandFlex(value: string): Expansion | null {
  const lower = value.toLowerCase().trim();
  const keyword: Readonly<Record<string, readonly [string, string, string]>> = {
    none: ['0', '0', 'auto'],
    auto: ['1', '1', 'auto'],
    initial: ['0', '1', 'auto'],
  };

  const preset = keyword[lower];
  const [grow, shrink, basis] = preset ?? classifyFlexParts(topLevelParts(value)) ?? [];
  if (grow === undefined || shrink === undefined || basis === undefined) return null;

  return {
    declarations: [
      { property: 'flex-grow', value: grow },
      { property: 'flex-shrink', value: shrink },
      { property: 'flex-basis', value: basis },
    ],
    confident: true,
  };
}

/**
 * A single number is `flex-grow`; a single length is `flex-basis`. The
 * one-value form is the only place the two are distinguishable at all, which is
 * why the split happens here rather than positionally.
 */
function classifyFlexParts(
  parts: readonly string[],
): readonly [string, string, string] | null {
  if (parts.length === 1) {
    const only = parts[0]!;
    if (isBareNumber(only)) return [only, '1', '0%'];
    if (isLength(only) || only === 'auto' || only === 'content') return ['1', '1', only];
    return null;
  }

  if (parts.length === 2) {
    const [first, second] = parts as [string, string];
    if (!isBareNumber(first)) return null;
    if (isBareNumber(second)) return [first, second, '0%'];
    return [first, '1', second];
  }

  if (parts.length === 3) {
    const [grow, shrink, basis] = parts as [string, string, string];
    if (!isBareNumber(grow) || !isBareNumber(shrink)) return null;
    return [grow, shrink, basis];
  }

  return null;
}

function expandFlexFlow(value: string): Expansion | null {
  const parts = topLevelParts(value);
  if (parts.length === 0 || parts.length > 2) return null;

  const wraps = new Set(['nowrap', 'wrap', 'wrap-reverse']);
  const directions = new Set(['row', 'row-reverse', 'column', 'column-reverse']);

  let direction: string | undefined;
  let wrap: string | undefined;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (directions.has(lower)) {
      if (direction !== undefined) return null;
      direction = lower;
    } else if (wraps.has(lower)) {
      if (wrap !== undefined) return null;
      wrap = lower;
    } else {
      return null;
    }
  }

  return {
    declarations: [
      { property: 'flex-direction', value: direction ?? 'row' },
      { property: 'flex-wrap', value: wrap ?? 'nowrap' },
    ],
    confident: true,
  };
}

function expandTextDecoration(value: string): Expansion | null {
  const parts = topLevelParts(value);
  if (parts.length === 0 || parts.length > 4) return null;

  const lines = new Set(['none', 'underline', 'overline', 'line-through', 'blink']);
  const styles = new Set(['solid', 'double', 'dotted', 'dashed', 'wavy']);

  const lineParts: string[] = [];
  let style: string | undefined;
  let color: string | undefined;
  let thickness: string | undefined;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lines.has(lower)) lineParts.push(lower);
    else if (styles.has(lower)) {
      if (style !== undefined) return null;
      style = lower;
    } else if (lower === 'auto' || lower === 'from-font' || isLength(part)) {
      if (thickness !== undefined) return null;
      thickness = part;
    } else if (lower === 'currentcolor' || parseColor(part) !== null || part.startsWith('var(')) {
      if (color !== undefined) return null;
      color = part;
    } else {
      return null;
    }
  }

  return {
    declarations: [
      { property: 'text-decoration-line', value: lineParts.length > 0 ? lineParts.join(' ') : 'none' },
      { property: 'text-decoration-style', value: style ?? 'solid' },
      { property: 'text-decoration-color', value: color ?? 'currentcolor' },
      { property: 'text-decoration-thickness', value: thickness ?? 'auto' },
    ],
    confident: true,
  };
}

/**
 * Split on whitespace, but never inside a function call.
 *
 * `margin: calc(1px + 2px) 0` is two values, not four. Splitting naively would
 * silently corrupt every `calc()`, `var()`, and gradient in the corpus.
 */
export function topLevelParts(value: string): string[] {
  const parts: string[] = [];
  let depth = 0;
  let current = '';

  for (const char of value.trim()) {
    if (char === '(') depth += 1;
    else if (char === ')') depth -= 1;

    if (depth === 0 && /\s/.test(char)) {
      if (current.length > 0) parts.push(current);
      current = '';
      continue;
    }
    current += char;
  }

  if (current.length > 0) parts.push(current);
  return parts;
}

/**
 * `inherit`, `initial`, `unset`, `revert`, and any `var()` reference are
 * indivisible: they apply to the whole shorthand and cannot be distributed to
 * longhands without resolving them first.
 */
function isGlobalKeywordAmbiguity(part: string): boolean {
  const lower = part.toLowerCase();
  return (
    lower === 'inherit' ||
    lower === 'initial' ||
    lower === 'unset' ||
    lower === 'revert' ||
    lower === 'revert-layer'
  );
}

function isLength(part: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)([a-z]+|%)?$/i.test(part) || part.toLowerCase().startsWith('calc(');
}

function isBareNumber(part: string): boolean {
  return /^[+-]?(\d+\.?\d*|\.\d+)$/.test(part);
}
