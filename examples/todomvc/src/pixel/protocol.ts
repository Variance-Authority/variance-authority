import type { CaptureRequest, PageAgent } from '@variance-authority/harness-playwright/agent';

/**
 * The wire contract between the pixel runner (Node) and the page agent (browser).
 *
 * Kept in its own module, free of side effects, because both halves import it:
 * `page-agent.ts` installs a global on load and cannot be imported from Node, and
 * a runner that duplicated these string constants would drift from the page
 * without anything failing.
 *
 * The naming is deliberately the harness's own `(subject, variant)` pair rather
 * than `(story, mutation)`. The harness moves those two strings and nothing else,
 * and reusing them means the pixel arm and the semantic arm address exactly the
 * same renders — which is the only way the head-to-head is a comparison rather
 * than two reports.
 */

/** `variant` for a render with no mutation applied. The stored golden image. */
export const BASELINE_VARIANT = 'baseline';

/**
 * Prefix marking a `subject` as a blind-spot probe rather than a story.
 *
 * Probes live outside `STORIES` on purpose. They exist to find cases where the
 * *pixel* arm wins, and folding them into the story set would quietly change the
 * corpus both arms are scored on.
 */
export const PROBE_PREFIX = 'probe:';

/** What `render` reports back: enough to notice a story that mounted empty. */
export interface RenderResult {
  readonly subject: string;
  readonly variant: string;
  /** CSS pixels of the `#subject` box — the region the screenshot will clip. */
  readonly width: number;
  readonly height: number;
}

/**
 * The todomvc page agent.
 *
 * `capture` is the harness's required method and produces a real `RawCapture`, so
 * this one page entry serves both arms.
 *
 * `render` is the addition, and it exists for fairness. Charging the pixel arm
 * for a semantic collection it never asked for would make the cost comparison a
 * fabrication, so the pixel runner mounts through `render` and pays for nothing
 * but React plus layout.
 */
export interface TodoPageAgent extends PageAgent {
  /** Mount `(subject, variant)` and return its box. No collection, no hashing. */
  readonly render: (request: RenderRequest) => string;
}

export interface RenderRequest {
  readonly subject: string;
  readonly variant: string;
}

/** Narrow a `CaptureRequest` to the fields the todomvc agent actually reads. */
export type TodoCaptureRequest = CaptureRequest;
