/**
 * The whole of this project's collector, now that one is shipped.
 *
 * **This file is the measurement.** It was 234 lines, in a directory of 341
 * across three files, and the comment above `Collector` in `packages/cli` cited
 * that number as the honest integration cost of this project against Percy's
 * twenty-plus SDKs. Everything that has gone is what
 * [`@variance-authority/storybook-collector`](../../../packages/storybook-collector)
 * now owns: serving the build, injecting the page bundle, driving the preview
 * channel, acquiring the document and the capture from one mount, normalizing,
 * and shutting the whole thing down without hanging on a socket.
 *
 * What is left is what was always genuinely this project's, and it is worth
 * reading as the answer to *what does an adopter still have to know*:
 *
 * - **which story defers its own readiness, and by what marker.** Storybook's
 *   `storyRendered` fires when the story function returns, which for a component
 *   that defers work is *before the component exists*. `AsyncPanel` needs a
 *   marker; a button does not, and demanding one from it would time out eight
 *   stories to solve a problem one of them has.
 * - **which story is about its own loading state.** `Suspense — never resolves`
 *   is refused without this line: a subtree still showing a fallback records a
 *   skeleton on a slow machine and a component on a fast one, so the run stops
 *   and names the boundary rather than photographing it. Nobody can sense the
 *   difference between that and a story whose subject *is* the skeleton, which
 *   is why the escape hatch is a declaration and lives here.
 * - **where its components live**, so a changed region resolves to a file.
 *
 * The case still proves what it existed to prove — the adapter is exercised
 * against a Storybook that Storybook built — and now also proves that the
 * generic half really was generic, because the same `cli.chromium.test.js` run
 * passes with this file in place of the one it was written against.
 */
import { storybookCollector } from '@variance-authority/storybook-collector';

export default storybookCollector({
  ready: { 'case-surface--deferred': '[data-testid="case-ready"]' },
  readyTimeoutMs: 30_000,
  loading: ['case-surface--suspense-stalled'],
  source: { dirs: ['cases/storybook-case/src'] },
});
