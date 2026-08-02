import type { Viewport } from '@variance-authority/core';

/**
 * The contract between the harness (Node) and the page (browser).
 *
 * The harness deliberately knows nothing about subjects, variants, React, or the
 * corpus. It moves two plain values across the bridge — a request in, a JSON
 * capture out — and everything that must touch a DOM lives on the far side, in a
 * bundle the caller supplies. That split is what lets one harness serve a
 * Storybook, a fixture page, or a route without acquiring a dependency on any of
 * them.
 *
 * It is also the sub-renderer boundary of ADR-0002 made concrete. Nothing here is
 * a live object, so the same agent could sit behind a worker, a pipe, or a device
 * farm rather than a `page.evaluate`.
 *
 * Published as its own entry point (`.../playwright/agent`) and carrying
 * no runtime import, because the page bundle imports it and the package's main
 * entry pulls in Playwright — which is Node-only, and bundling it for a browser
 * fails with sixty-odd unresolved `node:` builtins.
 */

/**
 * Name of the global the injected bundle must install.
 *
 * Deliberately not a `window.__va`-style short name: the agent shares a global
 * namespace with whatever application the page already loaded, and a collision
 * would be discovered as a confusing capture rather than as an error.
 */
export const AGENT_GLOBAL = '__variance_authority_page_agent__';

/** Everything the page needs that only the harness knows. */
export interface CaptureRequest {
  /** Opaque to the harness; the bundle decides what a subject is. */
  readonly subject: string;
  readonly variant: string;

  /** `SubjectRef.id` for the capture. Baselines are keyed on it. */
  readonly subjectId: string;

  readonly viewport: Viewport;

  /** Engine identity for the environment key, e.g. `chromium@151.0.7922.34`. */
  readonly engine: string;

  /**
   * Font content hashes. Passed through rather than sniffed in-page: a document
   * can see that `Inter` is in use but not which Inter, and a substitution moves
   * every rect without moving a line of code (see `collect`'s `fonts`).
   */
  readonly fonts?: readonly string[];

  readonly features?: Readonly<Record<string, string>>;
  readonly assets?: Readonly<Record<string, string>>;
}

/**
 * What the injected bundle installs at {@link AGENT_GLOBAL}.
 *
 * `capture` returns a JSON **string**, not an object. Playwright would happily
 * structured-clone the object, and that would hide the property ADR-0002 relies
 * on: a `RawCapture` has to survive a transport that carries text. Serializing
 * in-page makes the constraint load-bearing — a capture that acquires a `Map`, a
 * DOM handle, or a cycle fails here rather than three transports later.
 */
export interface PageAgent {
  readonly capture: (request: CaptureRequest) => string;
  /** Bundle identity, echoed into diagnostics when a run looks wrong. */
  readonly version?: string;
}
