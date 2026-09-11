/**
 * `@variance-authority/playwright` — everything that needs a browser, and only that.
 *
 * One package owns the `playwright` dependency, because a consumer who does not
 * render should not install one. Two tools live here, and they are separate tools
 * that happen to share a requirement:
 *
 * - a **harness**: one Chromium, one page, one navigation, one bundle injection,
 *   and a `RawCapture` per subject obtained by calling into the page. It carries
 *   no knowledge of subjects, stories, or frameworks — the page bundle supplies
 *   all of that through {@link PageAgent} — so the same harness serves a fixture
 *   page, a Storybook, or a route.
 * - a **renderer**: a `RenderDocument` in, a `Raster` out, satisfying the contract
 *   in `@variance-authority/raster` that a renderer across a network satisfies too.
 * - a **network observation**: what the page was actually served, which is the
 *   only place `EnvironmentInputs.assets` can come from and the only place an
 *   animated GIF can be frozen without a canvas and a CORS grant.
 *
 * The harness and the network observation are this entrypoint. `./renderer` is
 * its own, and `./agent` is the reason there are entrypoints at all: it is the
 * page-side half, bundled into the browser, and it must be importable without
 * dragging Playwright in behind it.
 *
 * See `docs/context/journal/0007-persistent-harness-and-p4.md` for what the
 * persistence is worth in wall-clock terms, and how to reproduce it.
 */

export { createHarness, captureOnce } from './harness.js';
export type { Harness, HarnessOptions } from './harness.js';

export { unresizable } from './viewport.js';
export { observeNetwork } from './network.js';
export type { BlankedAsset, NetworkObservation, NetworkOptions } from './network.js';

export { freezeGif } from './gif.js';
export { blankKey, blankPng, blankRuleError, blankRuleFor, imageSize } from './blank.js';
export type { BlankRule, ImageSize } from './blank.js';

export { fetchModules } from './modules.js';

export { createDeclarationReader } from './declarations.js';
export type { DeclarationReader, DeclarationReaderOptions, DeclarationStats } from './declarations.js';

export { acquireFromAgent } from './acquire.js';
