/**
 * What a Playwright run is told about where its record goes and what it
 * records: the values the recording fixtures and the reporter must agree on,
 * which `withTestSelection` hands to both.
 */

import type { InstrumentMode } from '@variance-authority/sense/journal';

/** Where the index and the block records live, when the defaults are wrong. */
export interface ExecutionRecording {
  /**
   * A directory inside the repository; defaults to the cwd. Recorded paths are
   * relative to the checkout it sits in, never to it.
   */
  readonly root?: string;
  /** Where the coverage layers live. Defaults to the repository's cache. */
  readonly cacheRoot?: string;
  /** The coverage index. Defaults to the repository's cache. */
  readonly coverageFile?: string;
  /** The suite this run is, as the root `variance.config.json` declares it under `suites`. */
  readonly suite?: string;
  /**
   * Services that report their own crossings, by the name each one collects
   * under.
   *
   * Empty is the default and the ordinary case: a suite driving one application
   * has one instrumented realm, the page, and nothing can be missing from it.
   * Naming a head is a promise that the service is running
   * `collectJourneys()` from `@variance-authority/sense/journey`. A named head
   * that reports nothing all run retires every observation the run made — the
   * setup is extra, and a run half of whose evidence never arrived must not
   * narrow the next one.
   */
  readonly heads?: readonly string[];
  /**
   * The origin the journey cookie is scoped to. Defaults to the project's
   * `baseURL`. Same-origin is the filter, so this is also the whole of the
   * decision about which services ever see it.
   */
  readonly origin?: string;
  /**
   * The probe recipe the build placed, matching `testSelectionProbes()`'s
   * `mode`. `presence` when absent, as it is there.
   *
   * The same answer on both sides or neither works: a journal cut by one
   * recipe and folded as another is refused, and a snapshot two seams write
   * under two recipes has each run retire the other's evidence.
   */
  readonly mode?: InstrumentMode;
  /**
   * Files whose contents are preconditions of every spec this run recorded.
   *
   * A `globalSetup`, a fixture module the specs share, a seeded dump —
   * nothing *enters* them, so no module row answers for them, and without
   * this a commit that edits one selects nothing at all.
   */
  readonly preconditions?: readonly string[];
  /**
   * Whether each statement of a test or a hook is cut, so the record says which
   * line of the test first reached each region its case entered. On by default.
   * Each statement of an async body waits while the page is drained, which is
   * one round trip to every frame per statement; turn it off to record a suite
   * exactly as it ran before cuts existed. `withTestSelection` reads it, since
   * the cut is a Babel plugin Playwright compiles every spec with.
   */
  readonly cadence?: boolean;
}
