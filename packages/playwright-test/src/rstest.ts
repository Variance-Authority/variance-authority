/**
 * The same five fields, read out of an Rstest run instead of a Playwright one.
 *
 * `@rstest/playwright` hands a test body a real `playwright` `Page` and no
 * `TestInfo` — its runner is Rstest, and Rstest keeps the run's identity
 * somewhere else: the title path is on `expect.getState()`, the spec file is on
 * `task`, and the resolved browser options are a fixture. {@link VarianceRun} is
 * the shape this package already observes through, so an Rstest suite needs a
 * reader for those four places and nothing else.
 *
 * It lives here rather than in a box of its own because the *requirement* is the
 * same one: a test that observes this way has Playwright and a browser binary,
 * whichever runner started it. A second package would be a second name for one
 * box (ADR-0013).
 *
 * The deferred half of an Rstest adoption — a `node` or `jsdom` test that writes
 * a capture for a later CLI run — reaches none of this. It has no page, no
 * browser and no run to describe; `@variance-authority/unit-test` is
 * runner-agnostic already and an Rstest test calls `capture()` the way a Vitest
 * one does.
 */

import { relative, resolve, sep } from 'node:path';
import type { VarianceRun } from './run.js';

/**
 * The parts of Rstest's test context this reads, structurally.
 *
 * Typed here rather than imported from `@rstest/core` for the reason
 * {@link VarianceRun} exists at all: a run descriptor should not oblige a
 * caller to hold a particular runner's types, and every field below is one an
 * Rstest test body destructures by name anyway.
 */
export interface RstestTask {
  /** Absolute path of the test file. */
  readonly filepath?: string;
  /** Absolute path the project was resolved from, which `owner` is relative to. */
  readonly projectRoot?: string;
}

/** Rstest's `expect`, narrowed to the state it publishes about the run. */
export interface RstestExpect {
  getState(): {
    readonly currentTestName?: string;
    readonly testPath?: string;
    readonly snapshotState?: { readonly snapshotUpdateState?: string };
  };
}

/**
 * The resolved `playwright` fixture, structurally — `definePlaywrightConfig`'s
 * options as the test receives them.
 */
export interface RstestPlaywrightOptions {
  readonly contextOptions?: {
    readonly colorScheme?: 'light' | 'dark' | 'no-preference' | null;
    readonly deviceScaleFactor?: number;
    readonly baseURL?: string;
  };
}

/** What an Rstest test body destructures, as much of it as this needs. */
export interface RstestContext {
  readonly task?: RstestTask;
  readonly expect?: RstestExpect;
  readonly playwright?: RstestPlaywrightOptions;
}

/**
 * Read an Rstest test context as the run it describes.
 *
 * ```ts
 * test('cart', async ({ page, task, expect, playwright }) => {
 *   const variance = await createVariance(page, runOf({ task, expect, playwright }), {});
 * });
 * ```
 *
 * The argument is spelled as three destructured fixtures because `@rstest/playwright`
 * requires the first parameter of a test body to be an object pattern — there is
 * no whole context object to pass on.
 */
export function runOf(context: RstestContext): VarianceRun {
  const state = context.expect?.getState();
  const options = context.playwright?.contextOptions;
  const baseURL = options?.baseURL;
  const file = context.task?.filepath ?? state?.testPath;

  return {
    // Rstest joins a suite chain with ` > `; Playwright's `titlePath` joins with
    // `/`, and the id is read as a place in both, so the separator is translated
    // rather than carried.
    ...(state?.currentTestName === undefined
      ? {}
      : { id: state.currentTestName.split(' > ').join('/') }),
    colorScheme: options?.colorScheme === 'dark' ? 'dark' : 'light',
    deviceScaleFactor: options?.deviceScaleFactor ?? 1,
    ...(baseURL === undefined ? {} : { baseURL }),
    ...(file === undefined
      ? {}
      : {
          owner: relative(resolve(context.task?.projectRoot ?? process.cwd()), file)
            .split(sep)
            .join('/'),
        }),
    // `all` and nothing else. Rstest's default is `new`, which writes a snapshot
    // that has no baseline yet — the same absence Playwright spells `missing`,
    // and reading it as approval would promote an image from the unreviewed run
    // that produced it (ADR-0021).
    accepting: state?.snapshotState?.snapshotUpdateState === 'all',
    // Deliberately unset. Rstest reports a result after the body returns, so
    // inside one there is no status to read, and guessing `false` would tell a
    // recorder a failing run had passed.
  };
}
