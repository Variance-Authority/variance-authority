/**
 * A variant is a *complete* description of how a subject was rendered — every knob
 * set, none inherited implicitly. Two variants differ in exactly the ways their
 * literal values differ, which is what lets a corpus case say "the only difference
 * between these two renders is X" as a checkable fact rather than a claim about
 * what the author remembered to hold constant.
 *
 * The knobs split into two kinds, and the split is the whole design:
 *
 * - **cruft knobs** (`idShift`, `classSalt`, `noiseSheets`, `spelling`, `wrapper`)
 *   change the bytes of the document without changing anything a user could
 *   perceive. Every one of them is a real, common, unavoidable source of churn in
 *   a React + CSS-in-JS + story-runner stack, and each is expected to be a no-op
 *   for the hash. These are what P1 is measured on.
 * - **real knobs** (`tokenOverrides`, `props`) change what is rendered. These are
 *   expected to move the hash, and the corpus records which band and how much
 *   collateral. They are also the false-negative guard: a normalizer that erased
 *   everything would pass every cruft case and fail all of these.
 */

import type { ButtonSize, ButtonVariant } from './components/Button.js';
import { BASE_ITEMS, PREPENDED_ITEMS, RELABELLED_ITEMS, ROTATED_ITEMS } from './components/ItemList.js';
import type { NoiseSheetId } from './cruft/irrelevant-css.js';
import type { StyleSpelling } from './cruft/spelling.js';

/** Subject-facing props. One flat record rather than a per-subject union: a
 * variant must be applicable to any subject so that the same perturbation can be
 * measured across several, and a union would force a cast at every call site. */
export interface SubjectProps {
  readonly buttonVariant: ButtonVariant;
  readonly buttonSize: ButtonSize;
  readonly cardAsRegion: boolean;
  readonly fieldBreakAssociation: boolean;
  readonly fieldWithError: boolean;
  readonly dialogOpen: boolean;
  readonly tabsSelected: number;
  readonly tabsStripPanelRole: boolean;
  readonly listItems: readonly string[];
  readonly heroPrimaryVariant: 'primary' | 'secondary';
  readonly heroTertiaryAction: boolean;
}

export interface WrapperSpec {
  readonly depth: number;
  readonly display: 'block' | 'contents';
  readonly target: 'block' | 'flex' | 'none';
}

export interface Perturbation {
  /** Throwaway `useId` consumers mounted before the subject. Renumbers every
   * generated id in the tree without touching the tree. */
  readonly idShift: number;
  /** Salt for the generated-class runtime. Renames every class, changes no
   * declaration. */
  readonly classSalt: string;
  /** Inapplicable (and, in two cases, deliberately applicable) stylesheets loaded
   * into the document alongside the subject's own. */
  readonly noiseSheets: readonly NoiseSheetId[];
  readonly spelling: StyleSpelling;
  /**
   * Non-semantic `<div>`s wrapped around *any* subject by `renderCase`, in the
   * container's block formatting context.
   *
   * Separate from {@link WrapperSpec}, which is internal to the `wrappers` fixture
   * and exists to put the same insertion into two different formatting contexts.
   * This one is what makes wrapper insertion part of the composed `all-cruft`
   * perturbation for subjects that have no wrapper knob of their own — without it,
   * `all-cruft` would silently omit the single most common no-op refactor there is
   * on every subject except one.
   */
  readonly subjectWrapperDepth: number;
  readonly wrapper: WrapperSpec;
  /** Custom-property values overridden at the subject root. */
  readonly tokenOverrides: Readonly<Record<string, string>>;
  readonly props: SubjectProps;
}

const BASE_PROPS: SubjectProps = {
  buttonVariant: 'primary',
  buttonSize: 'md',
  cardAsRegion: false,
  fieldBreakAssociation: false,
  fieldWithError: false,
  dialogOpen: false,
  tabsSelected: 0,
  tabsStripPanelRole: false,
  listItems: BASE_ITEMS,
  heroPrimaryVariant: 'primary',
  heroTertiaryAction: false,
};

/**
 * The baseline is not a clean room.
 *
 * It already carries harness chrome, a small pile of dead utilities, and one
 * generation of stale story rules — because a real canvas always does, and because
 * the claim worth measuring is the strong one: *irrelevant CSS **growing** does not
 * move the hash*. Against an empty baseline, the accretion cases would only prove
 * that noise can be tolerated when it appears, not when it accumulates.
 */
const BASE: Perturbation = {
  idShift: 0,
  classSalt: 'build-a',
  noiseSheets: ['chrome', 'dead-utilities-small', 'stale-stories-gen1'],
  spelling: 'shorthand',
  subjectWrapperDepth: 0,
  wrapper: { depth: 0, display: 'block', target: 'none' },
  tokenOverrides: {},
  props: BASE_PROPS,
};

function variant(
  overrides: Partial<Omit<Perturbation, 'props'>> & { readonly props?: Partial<SubjectProps> },
): Perturbation {
  const { props, ...rest } = overrides;
  return { ...BASE, ...rest, props: { ...BASE_PROPS, ...props } };
}

export const VARIANTS = {
  base: variant({}),

  // ---- cruft: expected to be no-ops -------------------------------------------

  /** React's global id counter advanced by 9. Every `useId` value in the subject
   * differs; every relationship between them is preserved. */
  'id-shift': variant({ idShift: 9 }),

  /** Same declarations, different generated class names — a sibling component's
   * edit, a library bump, a changed file name. */
  'class-churn': variant({ classSalt: 'build-b' }),

  /** The session got longer: 400 dead utilities instead of 25, four generations of
   * stale story rules instead of one. Roughly 15x the CSS, none of it applicable. */
  'css-accretion': variant({
    noiseSheets: ['chrome', 'dead-utilities-large', 'stale-stories-gen4'],
  }),

  /** Adds rules that *do* match the subject but lose the cascade. Pruning by
   * "matches?" alone keeps them; ADR-0003 step 5 drops them. */
  'css-losing-rules': variant({
    noiseSheets: ['chrome', 'dead-utilities-small', 'stale-stories-gen1', 'losing-rules'],
  }),

  /** Adds rules guarded by conditions that are false for the declared environment.
   * Flattening (step 2) removes them; digesting sheet text keeps them. */
  'css-unmatched-media': variant({
    noiseSheets: ['chrome', 'dead-utilities-small', 'stale-stories-gen1', 'unmatched-media'],
  }),

  /** `margin`/`padding`/`border-radius` written as longhands. Identical computed
   * values; a linter's `--fix` away from happening for real. */
  'spelling-longhand': variant({ spelling: 'longhand' }),

  /** Three extra `<div>`s in block flow: no role, no box. Applied both around the
   * subject as a whole and inside the `wrappers` fixture's block region. */
  'wrapper-block': variant({
    subjectWrapperDepth: 3,
    wrapper: { depth: 3, display: 'block', target: 'block' },
  }),

  /** Three extra `<div>`s with `display: contents` inside a flex row: no role, no
   * box, leaves remain flex items. */
  'wrapper-flex-contents': variant({ wrapper: { depth: 3, display: 'contents', target: 'flex' } }),

  /** Three extra block `<div>`s inside a flex row. Contested: inert under `jsdom`,
   * a real geometry change under `chromium`. See CORPUS. */
  'wrapper-flex-block': variant({ wrapper: { depth: 3, display: 'block', target: 'flex' } }),

  /** Everything above at once. Cruft in the wild never arrives one kind at a time,
   * and a normalizer can be correct on each in isolation while the combination
   * still moves — aliasing that runs before wrapper collapse sees different
   * document order than one that runs after. */
  'all-cruft': variant({
    idShift: 9,
    classSalt: 'build-b',
    noiseSheets: ['chrome', 'dead-utilities-large', 'stale-stories-gen4', 'losing-rules', 'unmatched-media'],
    spelling: 'longhand',
    subjectWrapperDepth: 3,
    wrapper: { depth: 3, display: 'block', target: 'block' },
  }),

  // ---- real changes: expected to move the hash ---------------------------------

  /** A rule that matches the subject and wins the cascade on document order. The
   * guard against a normalizer that simply deletes injected CSS. */
  'css-winning-rules': variant({
    noiseSheets: ['chrome', 'dead-utilities-small', 'stale-stories-gen1', 'winning-rules'],
  }),

  /** The same shape under a condition that is true. Pairs with
   * `css-unmatched-media`: together they mean "flatten", not "ignore". */
  'css-matched-media': variant({
    noiseSheets: ['chrome', 'dead-utilities-small', 'stale-stories-gen1', 'matched-media'],
  }),

  /** One token, narrow fan-out: accent reaches the primary Button's background and
   * the secondary Button's text. */
  'token-accent': variant({ tokenOverrides: { '--va-color-accent': '#0a7d55' } }),

  /** One token, wide fan-out: the mid step of the spacing scale is consumed by
   * Hero's row gap, both Buttons' horizontal padding, and the Tabs' tab padding. */
  'token-space-3': variant({ tokenOverrides: { '--va-space-3': '20px' } }),

  /** One token, single consumer: Card's radius, and nothing else. The narrow end
   * of the collateral-counting scale. */
  'token-radius': variant({ tokenOverrides: { '--va-radius-md': '14px' } }),

  /** A component-scoped override rather than a system token. Same resolved value
   * change, different root: "this Card" instead of "the radius scale". */
  'token-card-scoped': variant({ tokenOverrides: { '--ks-card-radius': '14px' } }),

  'prop-button-secondary': variant({ props: { buttonVariant: 'secondary' } }),
  'prop-button-large': variant({ props: { buttonSize: 'lg' } }),

  /** `<div>` becomes `<section role="region">`. No pixel need move. */
  'card-as-region': variant({ props: { cardAsRegion: true } }),

  /** `htmlFor` points at an id that exists nowhere. */
  'field-break-association': variant({ props: { fieldBreakAssociation: true } }),

  /** A second `aria-describedby` target appears. */
  'field-with-error': variant({ props: { fieldWithError: true } }),

  'dialog-open': variant({ props: { dialogOpen: true } }),
  'tabs-second': variant({ props: { tabsSelected: 1 } }),

  /** The panel loses `role="tabpanel"` and its `aria-labelledby`. Identical DOM
   * shape, identical styling, broken accessibility tree. */
  'tabs-strip-panel-role': variant({ props: { tabsStripPanelRole: true } }),

  'list-rotated': variant({ props: { listItems: ROTATED_ITEMS } }),
  'list-prepended': variant({ props: { listItems: PREPENDED_ITEMS } }),
  'list-relabelled': variant({ props: { listItems: RELABELLED_ITEMS } }),

  'hero-secondary-primary': variant({ props: { heroPrimaryVariant: 'secondary' } }),
  'hero-tertiary-action': variant({ props: { heroTertiaryAction: true } }),
} as const satisfies Record<string, Perturbation>;

export type VariantId = keyof typeof VARIANTS;

export const VARIANT_IDS = Object.keys(VARIANTS) as readonly VariantId[];

export function perturbationFor(id: VariantId): Perturbation {
  return VARIANTS[id];
}
