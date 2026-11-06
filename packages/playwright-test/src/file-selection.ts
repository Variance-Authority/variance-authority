/**
 * Dropping the files a selection skips, where Playwright decides which files a
 * project has.
 *
 * Playwright publishes no filter hook. It asks each project's `testIgnore`
 * about every file under `testDir` before it loads one and before it places a
 * shard, so a pattern there is the drop point: a `RegExp` whose `test` looks
 * the file up in the skip set costs one lookup a file. Its source, `(?!)`,
 * matches nothing, so a copy Playwright serializes by its source — the UI's
 * test server, a blob report — drops nothing.
 *
 * The configuration is evaluated synchronously and the selection is read
 * asynchronously, so the read waits for a `globalSetup` this adds ahead of the
 * project's own: Playwright runs every global setup in the process that
 * evaluated the configuration, and collects files after the last one returns.
 * A read that throws fails the global setup, and so the run.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import type { SuiteSelection } from '@variance-authority/sense/test-selection';
import { fileOwner } from './test-coordinate.js';

/** The `globalSetup` that reads the selection, by the path Playwright loads it from. */
export const SELECTION_SETUP = fileURLToPath(new URL('./selection-setup.js', import.meta.url));

/** The run's selection, shared by the configuration, its global setup and the reporter. */
export interface FileSelection {
  /** The checkout the selection names its files in. */
  readonly root: string;
  readonly read: () => Promise<SuiteSelection>;
  /** Set when the global setup has read it. */
  selection?: SuiteSelection;
  /** The files `testIgnore` dropped, as the selection names them. */
  readonly dropped: Set<string>;
  /** The files `testIgnore` let through, by absolute path: specs and the helpers beside them alike. */
  readonly passed: Set<string>;
  /** Whether the reporter has said what was selected. */
  told: boolean;
}

// On `globalThis`, because Playwright loads the configuration, the global setup
// and the reporter through its own transpiler, and each may get its own copy of
// this module.
const SELECTION = Symbol.for('variance-authority:playwright-selection');

/** The selection this process reads, once a configuration has asked for one. */
export function fileSelection(): FileSelection | undefined {
  return (globalThis as { [SELECTION]?: FileSelection })[SELECTION];
}

/** Ask for a selection in this process, read by the global setup. */
export function selectFiles(root: string, read: () => Promise<SuiteSelection>): void {
  (globalThis as { [SELECTION]?: FileSelection })[SELECTION] = { root, read, dropped: new Set(), passed: new Set(), told: false };
}

/** The pattern `testIgnore` takes to drop what the selection skips. */
export class SkippedFiles extends RegExp {
  constructor() {
    super('(?!)', 'u');
  }

  override test(file: string): boolean {
    const asked = fileSelection();
    // Before the global setup has read it — `--list` runs none — nothing is dropped.
    if (asked?.selection === undefined) return false;
    const name = fileOwner(asked.root, resolve(file));
    if (!asked.selection.skip.has(name)) {
      asked.passed.add(file);
      return false;
    }
    asked.dropped.add(name);
    return true;
  }
}

/**
 * The spec files the selection kept, as it names them: what `testIgnore` let
 * through and a project's `testMatch` takes, matched as Playwright matches it.
 */
export function keptFiles(asked: FileSelection, testMatches: readonly unknown[]): readonly string[] {
  const playwright = createRequire(createRequire(import.meta.url).resolve('@playwright/test/package.json'));
  const { createFileMatcher } = playwright('playwright/lib/util') as {
    createFileMatcher: (patterns: unknown) => (file: string) => boolean;
  };
  const matchers = testMatches.map(createFileMatcher);
  return [...asked.passed].filter((file) => matchers.some((matches) => matches(file))).map((file) => fileOwner(asked.root, resolve(file)));
}
