import type { CaptureArtifact } from '@variance-authority/core';
import type { Level } from '@variance-authority/core/judge';
import type { Observation } from '@variance-authority/observe';

/**
 * What crosses between the two halves, and why there are two halves at all.
 *
 * A browser-mode test runs in a real tab. Everything Variance needs to *read* a
 * subject is right there — the fiber tree, the stylesheets, the resources the
 * page can already fetch — and nothing it needs to *judge* one is: a baseline
 * lives on a disk, and painting a document is a browser the tab cannot launch.
 * Vitest's command protocol is the seam between the two, so the payload here is
 * plain JSON by obligation rather than by taste. A capture that picked up a
 * `Map`, a DOM node or a cycle has to fail at this boundary.
 */

/** The name the Node half registers, and the browser half calls. */
export const OBSERVE_COMMAND = 'varianceObserve';

/** How much of a subject is asserted on, when it has been relaxed. */
export interface Sensitivity {
  /** Stable name. Appears in the verdict and in every count this rule produces. */
  readonly rule: string;
  /** Why this subject is not asserted on in full. Required, as an ignore's is. */
  readonly reason: string;
  readonly level: Level;
}

export interface ObserveRequest {
  /**
   * The subject, read in the tab: markup, applicable CSS, provenance, and the
   * bytes of every resource it references.
   */
  readonly artifact: CaptureArtifact;
  readonly sensitivity?: Sensitivity;
}

export interface Observed extends Observation {
  /**
   * What a failing assertion prints.
   *
   * Rendered on the Node side and carried back, rather than formatted here from
   * the observation. `summarizeObservation` is the one formatter, and it lives
   * in a package that compares images — reaching for it from the tab would put
   * a PNG codec in the page bundle to produce a string.
   */
  readonly message: string;
}
