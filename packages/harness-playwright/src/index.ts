/**
 * `@variance-authority/harness-playwright` — the `chromium` half of ADR-0002.
 *
 * A persistent browser harness: one Chromium, one page, one navigation, one
 * bundle injection, and a `RawCapture` per subject obtained by calling into the
 * page. It carries no knowledge of subjects, stories, or frameworks — the page
 * bundle supplies all of that through {@link PageAgent} — so the same harness
 * serves a fixture page, a Storybook, or a route.
 *
 * See `docs/context/journal/0007-persistent-harness-and-p4.md` for what the
 * persistence is worth in wall-clock terms, and how to reproduce it.
 */

export { createHarness, captureOnce } from './harness.js';
export type { Harness, HarnessOptions } from './harness.js';

export { AGENT_GLOBAL } from './agent.js';
export type { CaptureRequest, PageAgent } from './agent.js';
