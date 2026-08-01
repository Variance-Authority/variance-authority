/**
 * The corpus's *legitimate* stylesheets — the ones a normalizer must keep.
 *
 * Everything a real app would load from disk lives here as a string instead,
 * because the fixtures have to install identical CSS under two very different
 * loaders: a JSDOM test with no bundler and no network, and a plain browser page
 * opened by Playwright. Making both go through `document.createElement('style')`
 * removes an entire class of "the browser saw different bytes than the test did"
 * failure, which in a corpus about false invalidation would be fatal.
 *
 * {@link TOKENS_CSS} is a copy of `tokens.css`, which remains the editable source
 * of truth so attribution has a real file and line to name (ADR-0003, side
 * channel). `sheets.test.ts` reads that file and fails if the copy drifts.
 */

/** Marker attribute on every `<style>` the fixtures inject, so teardown is total. */
export const SHEET_MARKER = 'data-va-sheet';

/**
 * Byte-identical copy of `src/styles/tokens.css`. Do not hand-edit: edit the
 * `.css` file and paste, or `sheets.test.ts` will fail.
 */
export const TOKENS_CSS = `/*
 * Design tokens for the kitchen-sink corpus.
 *
 * Why this file exists as a real \`.css\` file rather than a string in TypeScript:
 * the attribution side-channel of ADR-0003 promises sentences of the form
 * "padding 8→12 on \`Card\`, source: \`tokens.css:41\`". A token that has no file and
 * no line cannot be named that way, so the corpus needs a named sheet with stable
 * line numbers for the attributor to point at. \`styles/sheets.ts\` carries a
 * byte-identical copy so the fixtures can inject it without a bundler or an async
 * fetch; \`sheets.test.ts\` fails the build if the two ever drift.
 *
 * Every declaration below is deliberately consumed by more than one component, so
 * that a single-line edit here produces one root with counted collateral (spec
 * §6.2) rather than one isolated diff. A token nothing shares proves nothing.
 */
:root {
  --va-space-1: 4px;
  --va-space-2: 8px;
  --va-space-3: 12px;
  --va-space-4: 16px;
  --va-space-5: 24px;

  --va-radius-sm: 2px;
  --va-radius-md: 6px;
  --va-radius-lg: 12px;

  --va-color-surface: #ffffff;
  --va-color-ink: #101418;
  --va-color-muted: #5b6670;
  --va-color-border: #d4dae0;
  --va-color-accent: #2f6feb;
  --va-color-accent-ink: #ffffff;
  --va-color-danger: #b3261e;

  --va-shadow-1: 0 1px 2px rgba(16, 20, 24, 0.12);
  --va-shadow-2: 0 4px 12px rgba(16, 20, 24, 0.18);

  --va-font-sans: system-ui, sans-serif;
  --va-font-size-sm: 12px;
  --va-font-size-md: 14px;
  --va-font-size-lg: 20px;
  --va-line-height: 1.4;
}
`;

/**
 * The "design system" sheet: hand-authored, stable class names, every value
 * routed through a token.
 *
 * Two properties of this sheet are load-bearing for the corpus:
 *
 * 1. Nothing here is a generated class name. It is the control group against the
 *    CSS-in-JS runtime in `cruft/css-runtime.ts` — if a hash moves when only
 *    generated names churned, the difference between the two sheets localizes the
 *    bug.
 * 2. `.ks-card .ks-card__body` is written as a two-class descendant selector on
 *    purpose. It gives the accreted-CSS fixtures a known specificity of (0,2,0) to
 *    aim under (a rule that matches but loses the cascade → must not change the
 *    hash, ADR-0003 step 5) and to tie with from a later position (a rule that
 *    matches and wins → must change it).
 */
export const COMPONENTS_CSS = `
.ks-root {
  font-family: var(--va-font-sans);
  font-size: var(--va-font-size-md);
  line-height: var(--va-line-height);
  color: var(--va-color-ink);
}

.ks-card {
  background-color: var(--va-color-surface);
  border: 1px solid var(--va-color-border);
  box-shadow: var(--va-shadow-1);
}

.ks-card .ks-card__body {
  color: var(--va-color-ink);
  font-size: var(--va-font-size-md);
}

.ks-card__title {
  font-size: var(--va-font-size-lg);
  font-weight: 600;
  margin-top: 0;
  margin-bottom: var(--va-space-2);
}

.ks-field {
  display: block;
  margin-bottom: var(--va-space-3);
}

.ks-field__label {
  display: block;
  font-size: var(--va-font-size-sm);
  color: var(--va-color-muted);
  margin-bottom: var(--va-space-1);
}

.ks-field__input {
  display: block;
  width: 240px;
  padding-top: var(--va-space-1);
  padding-right: var(--va-space-2);
  padding-bottom: var(--va-space-1);
  padding-left: var(--va-space-2);
  border: 1px solid var(--va-color-border);
  border-radius: var(--va-radius-sm);
  font-size: var(--va-font-size-md);
  color: var(--va-color-ink);
}

.ks-field__help {
  font-size: var(--va-font-size-sm);
  color: var(--va-color-muted);
  margin-top: var(--va-space-1);
}

.ks-field__help--error {
  color: var(--va-color-danger);
}

.ks-tabs__list {
  display: flex;
  column-gap: var(--va-space-2);
  border-bottom: 1px solid var(--va-color-border);
}

.ks-tabs__tab {
  padding-top: var(--va-space-1);
  padding-right: var(--va-space-3);
  padding-bottom: var(--va-space-1);
  padding-left: var(--va-space-3);
  background-color: transparent;
  border-width: 0;
  color: var(--va-color-muted);
  font-size: var(--va-font-size-md);
}

.ks-tabs__tab[aria-selected='true'] {
  color: var(--va-color-accent);
  border-bottom: 2px solid var(--va-color-accent);
}

.ks-tabs__panel {
  padding-top: var(--va-space-3);
  color: var(--va-color-ink);
}

.ks-list {
  list-style-type: none;
  margin-top: 0;
  margin-bottom: 0;
  padding-left: 0;
}

.ks-list__item {
  padding-top: var(--va-space-1);
  padding-bottom: var(--va-space-1);
  border-bottom: 1px solid var(--va-color-border);
  color: var(--va-color-ink);
}

.ks-dialog__backdrop {
  position: fixed;
  top: 0;
  right: 0;
  bottom: 0;
  left: 0;
  background-color: rgba(16, 20, 24, 0.4);
}

.ks-dialog__panel {
  position: fixed;
  top: 40px;
  left: 40px;
  width: 320px;
  padding-top: var(--va-space-4);
  padding-right: var(--va-space-4);
  padding-bottom: var(--va-space-4);
  padding-left: var(--va-space-4);
  background-color: var(--va-color-surface);
  border-radius: var(--va-radius-lg);
  box-shadow: var(--va-shadow-2);
}

.ks-hero {
  display: flex;
  flex-direction: column;
  row-gap: var(--va-space-3);
  padding-top: var(--va-space-5);
  padding-right: var(--va-space-5);
  padding-bottom: var(--va-space-5);
  padding-left: var(--va-space-5);
}

.ks-hero__title {
  font-size: var(--va-font-size-lg);
  color: var(--va-color-ink);
  margin-top: 0;
  margin-bottom: 0;
}

.ks-hero__actions {
  display: flex;
  column-gap: var(--va-space-2);
}

.ks-wrappers__flex {
  display: flex;
  column-gap: var(--va-space-2);
}

/* Spacing is attached to the leaf, never to \`> *\`. A child-combinator rule would
 * be re-targeted onto an inserted wrapper, so the "extra <div> has no box effect"
 * fixture would be false by construction and would fail for a reason that has
 * nothing to do with wrapper collapse.
 *
 * \`flex-grow\` is here for the opposite reason, and it was added after measuring:
 * without it, wrapping a leaf in a plain <div> inside the flex row turned out to be
 * layout-neutral in Chromium after all — the wrapper shrink-to-fits to exactly the
 * width the leaf had — so the case meant to prove that formatting context decides
 * inertness proved nothing. \`flex-grow: 1\` is declared on the leaf and never moves;
 * what changes is whether the leaf is still a flex item for the declaration to
 * apply to. Same bytes, different resolved layout, which is precisely the
 * distinction the case is about. */
.ks-wrappers__leaf {
  color: var(--va-color-ink);
  font-size: var(--va-font-size-md);
  margin-bottom: var(--va-space-2);
  flex-grow: 1;
}
`;

/** Installs one `<style>` and tags it for teardown and for source attribution. */
export function installSheet(doc: Document, sourceName: string, css: string): HTMLStyleElement {
  const el = doc.createElement('style');
  el.setAttribute(SHEET_MARKER, sourceName);
  el.textContent = css;
  doc.head.appendChild(el);
  return el;
}

/** Removes every sheet the fixtures installed. Teardown must be total: a leaked
 * noise sheet would make the *next* case's "hash unchanged" claim vacuous. */
export function removeInstalledSheets(doc: Document): void {
  for (const el of Array.from(doc.querySelectorAll(`[${SHEET_MARKER}]`))) {
    el.remove();
  }
}
