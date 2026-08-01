/**
 * `@variance-authority/example-kitchen-sink` — the controlled corpus.
 *
 * Public component libraries cannot answer M0's exit question. They give real
 * markup but no ground truth: nobody can say in advance whether a given pair of
 * their renders *should* hash the same, so any measurement over them is a
 * measurement of the normalizer against itself. This package supplies the missing
 * half — pairs of renders whose correct answer was declared before the normalizer
 * existed, in {@link CORPUS} — and manufactures, deliberately, the noise that
 * ADR-0003 exists to delete.
 *
 * Two consumers, one code path: a Vitest file under `jsdom` and a Playwright page
 * both reach the fixtures through {@link renderCase}.
 */

export type { CorpusCase, CorpusSummary, ExpectedBand } from './corpus.js';
export { CORPUS, SETTLED_CORPUS, CONTESTED_CORPUS, casesFor, corpusSummary } from './corpus.js';

export type { SubjectId, SubjectContext } from './subjects.js';
export { SUBJECTS, SUBJECT_IDS } from './subjects.js';

export type { Perturbation, SubjectProps, VariantId, WrapperSpec } from './variants.js';
export { VARIANTS, VARIANT_IDS, perturbationFor } from './variants.js';

export type { RenderedCase } from './render.js';
export { renderCase } from './render.js';

export type { CssRuntime } from './cruft/css-runtime.js';
export { createCssRuntime } from './cruft/css-runtime.js';
export type { NoiseSheetId } from './cruft/irrelevant-css.js';
export { noiseSheet, deadUtilities, staleStories } from './cruft/irrelevant-css.js';
export { shiftIdCounter } from './cruft/id-shift.js';
export type { StyleSpelling } from './cruft/spelling.js';

export { TOKENS_CSS, COMPONENTS_CSS, SHEET_MARKER } from './styles/sheets.js';

export { Button } from './components/Button.js';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/Button.js';
export { Card } from './components/Card.js';
export type { CardProps } from './components/Card.js';
export { Dialog } from './components/Dialog.js';
export type { DialogProps } from './components/Dialog.js';
export { Field } from './components/Field.js';
export type { FieldProps } from './components/Field.js';
export { Hero } from './components/Hero.js';
export type { HeroProps } from './components/Hero.js';
export { ItemList } from './components/ItemList.js';
export type { ItemListProps } from './components/ItemList.js';
export { Tabs } from './components/Tabs.js';
export type { TabsProps } from './components/Tabs.js';
export { Wrappers } from './components/Wrappers.js';
export type { WrappersProps } from './components/Wrappers.js';
