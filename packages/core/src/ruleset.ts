/**
 * The normalization ruleset and computed-style allowlist.
 *
 * Both versions are components of the environment key, so **changing anything in
 * this file invalidates every baseline in every repository using it** (spec §7.3).
 * That is correct and intended — a rule change is a render-input change — but it
 * means edits here are releases, not tweaks. Bump the version in the same commit.
 */

/** Bump on any change to normalization behavior. */
export const RULESET_VERSION = 'r1';

/** Bump on any change to {@link STYLE_ALLOWLIST}. */
export const ALLOWLIST_VERSION = 'a1';

/**
 * Properties that enter a snapshot.
 *
 * The allowlist is the direct lever on the product's central tradeoff (spec
 * §11.3): too narrow and real regressions pass unseen; too wide and every
 * snapshot churns, reintroducing the fatigue that makes teams stop reading
 * diffs. So the admission test is deliberately strict —
 *
 * > Can a change to this property alone alter what a user sees or how assistive
 * > technology reports the page?
 *
 * Only longhands appear. Shorthands are expanded before matching, because
 * `margin: 4px` and `margin-top: 4px; …` must produce identical snapshots or
 * refactoring a stylesheet becomes a mass-invalidation event.
 *
 * Notable exclusions, each for a reason:
 * - `transition-*` / `animation-*` — snapshots are taken at a declared settle
 *   point with animation disabled, so these describe a journey the snapshot does
 *   not contain. Including them would make every easing tweak a diff.
 * - `cursor`, `user-select`, `will-change`, `contain` — invisible in both raster
 *   and the accessibility tree at rest.
 * - `content` — resolved pseudo-element text is captured as text, not as a
 *   declaration, so that it diffs like the content it is.
 */
export const STYLE_ALLOWLIST: readonly string[] = [
  // Box model and formatting context
  'display', 'position', 'top', 'right', 'bottom', 'left', 'float', 'clear',
  'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
  'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
  'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
  'box-sizing', 'overflow-x', 'overflow-y', 'z-index', 'aspect-ratio',

  // Flex and grid
  'flex-direction', 'flex-wrap', 'flex-grow', 'flex-shrink', 'flex-basis',
  'justify-content', 'align-items', 'align-self', 'align-content', 'order',
  'grid-template-columns', 'grid-template-rows', 'grid-template-areas',
  'grid-auto-columns', 'grid-auto-rows', 'grid-auto-flow',
  'grid-column-start', 'grid-column-end', 'grid-row-start', 'grid-row-end',
  'row-gap', 'column-gap',

  // Typography
  'font-family', 'font-size', 'font-weight', 'font-style', 'font-variant',
  'font-stretch', 'line-height', 'letter-spacing', 'word-spacing',
  'text-align', 'text-indent', 'text-transform', 'text-overflow',
  'text-decoration-line', 'text-decoration-color', 'text-decoration-style',
  'text-decoration-thickness', 'white-space', 'word-break', 'overflow-wrap',
  'vertical-align', 'writing-mode', 'direction',

  // Paint
  'color', 'opacity', 'background-color', 'background-image',
  'background-position', 'background-size', 'background-repeat',
  'background-clip', 'background-origin',
  'border-top-width', 'border-right-width', 'border-bottom-width', 'border-left-width',
  'border-top-style', 'border-right-style', 'border-bottom-style', 'border-left-style',
  'border-top-color', 'border-right-color', 'border-bottom-color', 'border-left-color',
  'border-top-left-radius', 'border-top-right-radius',
  'border-bottom-right-radius', 'border-bottom-left-radius',
  'outline-width', 'outline-style', 'outline-color', 'outline-offset',
  'box-shadow', 'text-shadow', 'filter', 'backdrop-filter', 'mix-blend-mode',

  // Visibility and geometry transforms
  'visibility', 'content-visibility', 'transform', 'transform-origin',
  'object-fit', 'object-position',

  // Tables
  'table-layout', 'border-collapse', 'border-spacing', 'caption-side',
];

const ALLOWED = new Set(STYLE_ALLOWLIST);

export function isAllowedProperty(property: string): boolean {
  return ALLOWED.has(property);
}

/**
 * Custom properties are always admitted, whatever their name.
 *
 * They cannot be enumerated in advance — every project invents its own — and they
 * are the mechanism design tokens travel through, which makes them the highest-
 * value signal the system collects: a custom property resolves a *name* alongside
 * a value, and that name is what lets one token edit collapse into one docket
 * root with counted collateral rather than hundreds of separate colour diffs.
 */
export function isCustomProperty(property: string): boolean {
  return property.startsWith('--');
}

/** Whether a property survives the allowlist projection (ADR-0003 step 4). */
export function admits(property: string): boolean {
  return isCustomProperty(property) || isAllowedProperty(property);
}

/**
 * Attributes kept on a semantic node.
 *
 * An allowlist rather than a denylist. Frameworks emit an open-ended supply of
 * bookkeeping attributes — `data-reactroot`, `data-styled`, `data-testid`,
 * `data-v-7f3a`, Storybook's own markers — and a denylist would need a new entry
 * for each one, silently churning baselines until someone noticed. Anything not
 * named here is dropped.
 *
 * `class` is absent by design (ADR-0003): a class name records *how* a style was
 * applied, and the snapshot already records *what* was applied, resolved.
 * `id` is absent because it has been replaced by a structural alias.
 * `aria-*` is absent because those are resolved into `role`/`name`/`state`,
 * which is what actually reaches a user.
 */
export const ATTRIBUTE_ALLOWLIST: readonly string[] = [
  'type', 'value', 'checked', 'disabled', 'readonly', 'required', 'multiple',
  'placeholder', 'name', 'href', 'target', 'rel', 'src', 'alt', 'title',
  'for', 'form', 'list', 'headers', 'colspan', 'rowspan', 'scope',
  'lang', 'dir', 'hidden', 'open', 'selected', 'download',
  'min', 'max', 'step', 'pattern', 'maxlength', 'minlength', 'autocomplete',
  'role', 'tabindex', 'draggable', 'contenteditable',
  'width', 'height', 'loading', 'decoding', 'srcset', 'sizes', 'poster', 'controls',
];

const ATTRIBUTES = new Set(ATTRIBUTE_ALLOWLIST);

export function admitsAttribute(name: string): boolean {
  return ATTRIBUTES.has(name);
}

/**
 * Attributes whose values are id references, rewritten to structural aliases.
 *
 * Aliasing rather than masking is what preserves the *relationship* while
 * deleting the volatile *value* (ADR-0003): a `useId` renumbering becomes a
 * no-op, while breaking a `label ↔ input` association stays a real structural
 * change. Masking both to a constant cannot tell those apart.
 */
export const ID_REFERENCE_ATTRIBUTES: readonly string[] = [
  'id', 'for', 'form', 'list', 'headers',
  'aria-labelledby', 'aria-describedby', 'aria-controls', 'aria-owns',
  'aria-activedescendant', 'aria-details', 'aria-errormessage', 'aria-flowto',
];

/** Attributes holding a *space-separated list* of id references, not just one. */
export const ID_REFERENCE_LIST_ATTRIBUTES: readonly string[] = [
  'headers', 'aria-labelledby', 'aria-describedby', 'aria-controls',
  'aria-owns', 'aria-flowto',
];
