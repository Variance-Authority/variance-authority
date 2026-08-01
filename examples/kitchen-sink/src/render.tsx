/**
 * One render entry point for both observation profiles.
 *
 * ADR-0002 makes `jsdom` and `chromium` separate baselines, but only because they
 * *observe* differently — they must not also *render* differently, or P4 ("both
 * profiles agree on the dimensions both can observe") is measuring the fixture
 * instead of the collectors. So the DOM-facing work happens exactly once, here,
 * and a Playwright page and a Vitest file reach it through the same call.
 *
 * That is also why the stylesheets are injected from TypeScript strings rather
 * than `<link>`ed in the browser and read from disk in the test: two loaders is
 * two chances for the two profiles to see different bytes.
 *
 * **One case per document.** `renderCase` owns document-level state — the injected
 * sheets, the accreting runtime `<style>`, the portal host — and clears the
 * previous case's before installing its own. Rendering two cases into one document
 * concurrently would let one case's noise sheets decide another's verdict, which
 * is the exact confound the corpus exists to eliminate. Use one iframe or one page
 * load per case.
 */

import type { ReactNode } from 'react';
import { createRoot } from 'react-dom/client';
import type { Root } from 'react-dom/client';
import { flushSync } from 'react-dom';

import { CssRuntimeContext, createCssRuntime, createRuntimeSheet } from './cruft/css-runtime.js';
import type { CssRuntime } from './cruft/css-runtime.js';
import { shiftIdCounter } from './cruft/id-shift.js';
import { noiseSheet } from './cruft/irrelevant-css.js';
import { SpellingContext } from './cruft/spelling.js';
import { COMPONENTS_CSS, TOKENS_CSS, installSheet, removeInstalledSheets } from './styles/sheets.js';
import { SUBJECTS } from './subjects.js';
import type { SubjectId } from './subjects.js';
import { perturbationFor } from './variants.js';
import type { VariantId } from './variants.js';

const PORTAL_HOST_MARKER = 'data-va-portal-host';

export interface RenderedCase {
  readonly container: HTMLElement;
  /**
   * Where portalled content landed. Handed back explicitly because whether it is
   * part of the subject is an open question (see `Dialog.tsx`) — a collector
   * cannot answer it if the fixture never tells it the host exists.
   */
  readonly portalHost: HTMLElement;
  /** The accreting CSS-in-JS `<style>`, for fixtures that assert about growth. */
  readonly runtimeSheet: HTMLStyleElement;
  readonly runtime: CssRuntime;
  unmount(): void;
}

/**
 * Renders `(subject, variant)` into `container`.
 *
 * Order is not incidental. Tokens and the components sheet go in first, noise
 * after, and the generated-class runtime last — so the "matches and wins on
 * document order" fixture actually wins, and the losing-rules fixture actually
 * loses. A different order would silently invert two of the corpus's cases.
 */
export function renderCase(container: HTMLElement, subject: SubjectId, variant: VariantId): RenderedCase {
  const doc = container.ownerDocument;
  const p = perturbationFor(variant);

  removeInstalledSheets(doc);
  for (const host of Array.from(doc.querySelectorAll(`[${PORTAL_HOST_MARKER}]`))) host.remove();

  installSheet(doc, 'tokens.css', TOKENS_CSS);
  installSheet(doc, 'components.css', COMPONENTS_CSS);
  for (const id of p.noiseSheets) installSheet(doc, id, noiseSheet(id));

  const runtimeSheet = createRuntimeSheet(doc);
  const runtime = createCssRuntime(p.classSalt, runtimeSheet);

  const portalHost = doc.createElement('div');
  portalHost.setAttribute(PORTAL_HOST_MARKER, '');
  doc.body.appendChild(portalHost);

  // Token overrides land on the subject root as inline custom properties. They
  // resolve exactly as an edit to `tokens.css` would, but their *attributed
  // source* differs — see the journal's note on what this fixture cannot show.
  container.removeAttribute('style');
  for (const [name, value] of Object.entries(p.tokenOverrides)) {
    container.style.setProperty(name, value);
  }
  container.className = 'ks-root';

  shiftIdCounter(doc, p.idShift);

  // Non-semantic wrappers around the subject as a whole. The container is a plain
  // block box, so these carry no role and generate no box effect for any subject —
  // which is why the generic insertion lives here and the formatting-context
  // variations live inside the `wrappers` fixture, where the context is the point.
  let subjectTree: ReactNode = SUBJECTS[subject](p, { portalHost });
  for (let i = 0; i < p.subjectWrapperDepth; i += 1) {
    subjectTree = <div key={`subject-wrapper-${i}`}>{subjectTree}</div>;
  }

  const tree: ReactNode = (
    <SpellingContext.Provider value={p.spelling}>
      <CssRuntimeContext.Provider value={runtime}>{subjectTree}</CssRuntimeContext.Provider>
    </SpellingContext.Provider>
  );

  const root: Root = createRoot(container);
  // Synchronous by construction: a collector must be able to read the DOM on the
  // line after `renderCase` returns, with no scheduler, timer, or `act` in the
  // contract. StrictMode is deliberately *not* used — its double render would
  // advance the `useId` counter twice and make `idShift` mean something different
  // in development than in a Playwright run.
  flushSync(() => {
    root.render(tree);
  });

  return {
    container,
    portalHost,
    runtimeSheet,
    runtime,
    unmount() {
      root.unmount();
      portalHost.remove();
      removeInstalledSheets(doc);
      container.removeAttribute('style');
      container.className = '';
    },
  };
}
