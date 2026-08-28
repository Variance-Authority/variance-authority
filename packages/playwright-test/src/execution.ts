/**
 * What a Playwright run executed, recorded for the next run's selection.
 *
 * The instrument is the one `@variance-authority/sense` already uses; only the
 * transport differs, which is the rule
 * [spec 0028](../../../docs/specs/0028-the-instrument.md) states. The adopter's
 * application build carries `testSelectionProbes()`, the page counts block
 * crossings, and this drains those counters around each observation.
 *
 * ## Why the owner is a file
 *
 * A story is a subject this tool shows one at a time, so it may be selected on
 * its own. A Playwright test is not: the runner's unit of execution is the spec
 * file, so attributing crossings to a title would record a distinction no
 * `--since` could spend. Every observation in one file joins that file, and the
 * file is what gets selected.
 */

import type { Page, TestInfo } from '@playwright/test';
import {
  drainExecution,
  preconditionOf,
  recordExecution,
  type ObservedSubject,
} from '@variance-authority/sense/journal';
import { relative, resolve, sep } from 'node:path';

/** Where the index and the block inventory live, when the defaults are wrong. */
export interface ExecutionRecording {
  /** Repository root the recorded paths are relative to. Defaults to the cwd. */
  readonly root?: string;
  /** Matches the `label` given to `testSelectionProbes()`. Defaults to `build`. */
  readonly label?: string;
  /** The inventory that build wrote. Defaults to the label's repository-keyed file. */
  readonly modulesFile?: string;
  /** The coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
}

/** One worker's accumulation, drained per observation and written once. */
export interface ExecutionRecorder {
  /** Take everything the page has entered since the last drain. */
  readonly note: (page: Page, owner: string) => Promise<void>;
  /** Say whether this owner's tests finished; an incomplete owner never excludes. */
  readonly mark: (owner: string, complete: boolean) => void;
  /** Merge this worker's contribution into the index, or explain the silence. */
  readonly close: () => Promise<void>;
}

interface Accumulated {
  readonly hits: Map<string, Set<number>>;
  complete: boolean;
}

/** The test file a subject's crossings belong to, repository-relative. */
export function ownerOf(root: string, testInfo: TestInfo): string {
  return relative(resolve(root), testInfo.file).split(sep).join('/');
}

/**
 * Collect one worker's crossings.
 *
 * Workers are processes, and each one writes the shared index at teardown under
 * the lock `recordExecution` takes. Accumulating first is what keeps that
 * to one contended write per worker instead of one per assertion.
 */
export function createExecutionRecorder(
  recording: ExecutionRecording = {},
): ExecutionRecorder {
  const root = resolve(recording.root ?? process.cwd());
  const owners = new Map<string, Accumulated>();
  let seen = false;
  let instrumentation: string | undefined;

  return {
    note: async (page, owner) => {
      const journal = await drainExecution(page);
      if (journal === undefined) return;
      seen = true;
      instrumentation = journal.instrumentation;
      const accumulated = owners.get(owner) ?? { hits: new Map(), complete: true };
      for (const module of journal.modules) {
        const ordinals = accumulated.hits.get(module.file) ?? new Set<number>();
        for (const ordinal of module.hits) ordinals.add(ordinal);
        accumulated.hits.set(module.file, ordinals);
      }
      owners.set(owner, accumulated);
    },

    mark: (owner, complete) => {
      const accumulated = owners.get(owner);
      // Conservative on purpose: one failed test in a file retires the whole
      // file's claim, because the crossings it did not reach are unknowable and
      // an exclusion built on them would be a skip nobody asked for.
      if (accumulated !== undefined && !complete) accumulated.complete = false;
    },

    close: async () => {
      if (!seen) {
        process.stderr.write(
          'variance-authority: execution recording is on and the page under test has no ' +
            'collector — build the application with `testSelectionProbes()` from ' +
            '`@variance-authority/sense/journal`, or the next `--since` will run ' +
            'every spec\n',
        );
        return;
      }
      const subjects: ObservedSubject[] = [];
      for (const [owner, accumulated] of owners) {
        const precondition = await preconditionOf(root, owner);
        subjects.push({
          owner,
          complete: accumulated.complete,
          journal: {
            instrumentation: instrumentation!,
            modules: [...accumulated.hits].map(([file, ordinals]) => ({
              file,
              hits: [...ordinals],
            })),
          },
          ...(precondition === undefined ? {} : { preconditions: [precondition] }),
        });
      }
      const record = await recordExecution({
        root,
        subjects,
        ...(recording.label === undefined ? {} : { label: recording.label }),
        ...(recording.modulesFile === undefined ? {} : { modulesFile: recording.modulesFile }),
        ...(recording.coverageFile === undefined ? {} : { coverageFile: recording.coverageFile }),
      });
      if (!record.recorded) {
        process.stderr.write(
          `variance-authority: recorded no test execution — ${record.because}\n`,
        );
      }
    },
  };
}
