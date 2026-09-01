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
  joinObservations,
  preconditionOf,
  recordExecution,
  type ObservedSubject,
} from '@variance-authority/sense/journal';
import {
  JOURNEY_COOKIE,
  JOURNEY_DIRECTORY_VARIABLE,
  mintJourney,
  stitchJourneys,
} from '@variance-authority/sense/journey';
import type { CoveragePrecondition } from '@variance-authority/sense/test-selection';
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
  /**
   * Services that report their own crossings, by the name each one collects
   * under.
   *
   * Empty is the default and the ordinary case: a suite driving one application
   * has one instrumented realm, the page, and nothing can be missing from it.
   * Naming a head is a promise that the service is running
   * `collectJourneys()` from `@variance-authority/sense/journey` and was pointed
   * at the same run directory. A named head that reports nothing all run retires
   * every observation the run made — the setup is extra, and a run half of whose
   * evidence never arrived must not narrow the next one.
   */
  readonly heads?: readonly string[];
  /**
   * Where heads report. Defaults to `VARIANCE_AUTHORITY_JOURNEYS`, which is also
   * how the service was told, so one variable in `webServer.env` configures both
   * ends.
   */
  readonly journeys?: string;
  /**
   * The origin the journey cookie is scoped to. Defaults to the project's
   * `baseURL`. Same-origin is the filter, so this is also the whole of the
   * decision about which services ever see it.
   */
  readonly origin?: string;
}

/** One worker's accumulation, drained per observation and written once. */
export interface ExecutionRecorder {
  /** Take everything the page has entered since the last drain. */
  readonly note: (page: Page, owner: string) => Promise<void>;
  /**
   * Mint this execution's journey and put it on the page's context.
   *
   * One opaque id per attempt, not per subject: a flake and its retry are two
   * executions and the heads must be able to tell them apart. The browser
   * attaches it to every same-origin request — navigations, subresources,
   * `fetch` a library made with no `credentials` option, `sendBeacon`, a form
   * POST — so nothing in the application is touched to carry it.
   */
  readonly join: (page: Page, owner: string, origin?: string) => Promise<void>;
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
  const heads = recording.heads ?? [];
  const journeys = recording.journeys ?? process.env[JOURNEY_DIRECTORY_VARIABLE];
  const minted = new Map<string, string>();
  const failed = new Set<string>();
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

    join: async (page, owner, origin) => {
      if (heads.length === 0) return;
      const url = recording.origin ?? origin;
      if (url === undefined) {
        // Nothing is set, so every head stays silent and `close` declines. The
        // sentence is here because this failure has a fix the generic one does
        // not name.
        process.stderr.write(
          'variance-authority: journey recording needs an origin to scope its cookie to and ' +
            'this project has no `baseURL`; heads will report nothing and this run will not ' +
            'narrow the next one\n',
        );
        return;
      }
      const journey = mintJourney();
      minted.set(journey, owner);
      await page.context().addCookies([{ name: JOURNEY_COOKIE, value: journey, url }]);
    },

    mark: (owner, complete) => {
      // Conservative on purpose: one failed test in a file retires the whole
      // file's claim, because the crossings it did not reach are unknowable and
      // an exclusion built on them would be a skip nobody asked for.
      //
      // Held apart from the accumulation rather than on it, because a head-only
      // run has no page journal to hang the verdict from and the verdict is the
      // same fact either way.
      if (complete) return;
      failed.add(owner);
      const accumulated = owners.get(owner);
      if (accumulated !== undefined) accumulated.complete = false;
    },

    close: async () => {
      if (!seen && heads.length === 0) {
        process.stderr.write(
          'variance-authority: execution recording is on and the page under test has no ' +
            'collector — build the application with `testSelectionProbes()` from ' +
            '`@variance-authority/sense/journal`, or the next `--since` will run ' +
            'every spec\n',
        );
        return;
      }

      // Every spec this worker ran, whether or not the page had anything to
      // drain: a suite may instrument only its services, and the spec files are
      // still the owners those services report against.
      const everyOwner = new Set([...owners.keys(), ...minted.values()]);
      const preconditions = new Map<string, readonly CoveragePrecondition[]>();
      const incomplete = new Set<string>(failed);
      for (const owner of everyOwner) {
        const precondition = await preconditionOf(root, owner);
        if (precondition !== undefined) preconditions.set(owner, [precondition]);
      }

      // Every head first: what they add up to decides whether the page's own
      // observations may be believed whole, so it cannot be settled afterwards.
      const stitched = await stitchJourneys({
        ...(journeys === undefined ? {} : { directory: journeys }),
        heads,
        owners: minted,
        preconditions,
        incomplete,
      });
      if (heads.length > 0 && journeys === undefined) {
        process.stderr.write(
          `variance-authority: ${heads.join(', ')} named as heads and ` +
            `${JOURNEY_DIRECTORY_VARIABLE} is not set, so nothing told them where to report; ` +
            'this run recorded nothing a later `--since` may narrow by\n',
        );
      } else if (!stitched.complete) {
        process.stderr.write(`variance-authority: ${stitched.because}\n`);
      }

      const subjects: ObservedSubject[] = [];
      for (const [owner, accumulated] of owners) {
        subjects.push({
          owner,
          complete: accumulated.complete && stitched.complete,
          journal: {
            instrumentation: instrumentation!,
            modules: [...accumulated.hits].map(([file, ordinals]) => ({
              file,
              hits: [...ordinals],
            })),
          },
          ...(preconditions.has(owner) ? { preconditions: preconditions.get(owner)! } : {}),
        });
      }

      // One record per run. The page's crossings and every head's describe the
      // same executions of the same subjects, so a second call naming those
      // subjects reads to the merge as a second run and retires what the first
      // wrote. They are joined here and written once, against every inventory
      // the run drove.
      const joined = joinObservations([subjects, ...stitched.heads.values()]);
      if (joined.length === 0) return;
      const record = await recordExecution({
        root,
        subjects: joined,
        // A run whose page carried no collector has no page inventory: every
        // ordinal in it came from a head, and asking for a build nothing
        // instrumented would decline a run that went fine.
        ...(seen
          ? {
              ...(recording.label === undefined ? {} : { label: recording.label }),
              ...(recording.modulesFile === undefined
                ? {}
                : { modulesFile: recording.modulesFile }),
            }
          : { modulesFile: [] }),
        ...(recording.coverageFile === undefined ? {} : { coverageFile: recording.coverageFile }),
        ...(stitched.heads.size === 0 ? {} : { heads: [...stitched.heads.keys()] }),
      });
      if (!record.recorded) {
        process.stderr.write(
          `variance-authority: recorded no test execution — ${record.because}\n`,
        );
      }
    },
  };
}
