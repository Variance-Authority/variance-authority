/**
 * Render impact: what a changed property can actually disturb.
 *
 * This is a **second axis**, orthogonal to the frequency bands of §5, and adding
 * it rather than folding it into them is deliberate. A band answers *what kind of
 * thing changed* — structure, a value, sub-pixel noise. Impact answers *how far
 * the change can reach*.
 *
 * The two genuinely differ. A spacing token and a colour token are both `token`
 * band: a value moved, structure held. But changing spacing reflows the document,
 * so it can move a node on the other side of the page; changing colour repaints
 * one box and can move nothing at all. Reporting both as "a token changed" hides
 * the only thing a reviewer wants to know first.
 *
 * The useful consequence is a **bound on collateral**:
 *
 * > A paint-only change has no geometric collateral. Ever.
 *
 * That is not a heuristic — it follows from how rendering works. So a subject
 * whose every delta is paint-impact needs no layout comparison to rule out
 * geometry regressions, which is exactly the kind of question a profile without a
 * layout engine can otherwise never settle. It is how the cheap tier answers
 * *"could this have moved anything?"* without measuring anything.
 */

export type PropertyImpact =
  /** Reflows: box sizes and positions may change, here and elsewhere. */
  | 'layout'
  /** Repaints in place. The box tree is untouched, so nothing moves. */
  | 'paint'
  /** Compositing only: transform, opacity, stacking. No reflow, no repaint. */
  | 'composite';

/**
 * Properties that change the box tree.
 *
 * Includes the typography metrics, which is easy to get wrong: `font-size`,
 * `line-height`, `letter-spacing`, and `text-transform` all change glyph
 * advances, so they resize the boxes containing them and reflow everything after.
 * A "typography token" change is a layout change, not a styling one.
 */
const LAYOUT: readonly string[] = [
  'display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'box-sizing', 'overflow-x', 'overflow-y', 'aspect-ratio',

  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-self', 'align-content', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  'row-gap', 'column-gap',

  'font-family', 'font-size', 'font-weight', 'font-style', 'font-stretch',
  'font-variant', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-indent', 'text-transform', 'white-space', 'word-break',
  'overflow-wrap', 'text-overflow', 'vertical-align', 'writing-mode', 'direction',

  // Border *width* occupies space; border colour does not. The style longhand
  // belongs here too, because `none` collapses the border to zero width whatever
  // the declared width says.
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',

  'table-layout', 'border-collapse', 'border-spacing', 'caption-side',
  'content-visibility',
];

/** Properties that repaint a box without resizing or moving it. */
const PAINT: readonly string[] = [
  'color', 'background-color', 'background-image', 'background-position',
  'background-size', 'background-repeat', 'background-clip', 'background-origin',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'box-shadow', 'text-shadow',
  'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
  'text-decoration-thickness',
  'object-fit', 'object-position',

  // `outline` is painted outside the box and never affects layout — that is the
  // whole reason it exists as a separate property from `border`.
  'outline-width', 'outline-style', 'outline-color', 'outline-offset',

  // `visibility: hidden` still occupies its space, unlike `display: none`.
  'visibility',
];

/** Properties handled by the compositor. */
const COMPOSITE: readonly string[] = [
  'transform', 'transform-origin', 'opacity', 'filter', 'backdrop-filter',
  'mix-blend-mode', 'z-index',
];

const IMPACTS = new Map<string, PropertyImpact>([
  ...LAYOUT.map((property) => [property, 'layout'] as const),
  ...PAINT.map((property) => [property, 'paint'] as const),
  ...COMPOSITE.map((property) => [property, 'composite'] as const),
]);

/**
 * Impact of a property change.
 *
 * An unrecognized property is reported as `layout`, the widest answer. Impact is
 * used to *rule out* collateral, so an unknown treated as paint-only would let a
 * real reflow pass unexamined — the over-reporting direction, as everywhere else.
 */
export function impactOf(property: string): PropertyImpact {
  // A custom property is only ever a carrier; what it costs depends entirely on
  // where it was consumed, which the caller knows and this function does not.
  if (property.startsWith('--')) return 'layout';
  return IMPACTS.get(property) ?? 'layout';
}

/**
 * Whether a change to this property can move anything.
 *
 * The question the cheap tier can answer without a layout engine, and the reason
 * this axis exists.
 */
export function canReflow(property: string): boolean {
  return impactOf(property) === 'layout';
}

export type AggregateImpact = PropertyImpact | 'mixed' | 'structural';

/**
 * Combine impacts for a group of changes.
 *
 * `structural` wins over everything: a node appearing or disappearing is not a
 * property change at all, and describing it in terms of repaint versus reflow
 * would understate it.
 */
export function aggregateImpact(
  impacts: readonly (PropertyImpact | 'structural')[],
): AggregateImpact {
  if (impacts.length === 0) return 'paint';
  if (impacts.includes('structural')) return 'structural';

  const distinct = new Set(impacts);
  if (distinct.size === 1) return [...distinct][0] as PropertyImpact;
  return 'mixed';
}
