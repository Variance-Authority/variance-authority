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
  type ModuleId,
  type ObservedSubject,
} from '@variance-authority/sense/journal';
import {
  journeyReportFrom,
  mintJourney,
  stitchJourneys,
  type JourneyReport,
} from '@variance-authority/sense/journey';
import type { CoveragePrecondition } from '@variance-authority/sense/test-selection';
import { JOURNEY_COOKIE, RETURN_COOKIE } from '@variance-authority/wire';
import { listen, type Wire } from '@variance-authority/wire/listen';
import { relative, resolve, sep } from 'node:path';

/** Where the index and the block records live, when the defaults are wrong. */
export interface ExecutionRecording {
  /** Repository root the recorded paths are relative to. Defaults to the cwd. */
  readonly root?: string;
  /** Matches the `label` given to `testSelectionProbes()`. Defaults to `build`. */
  readonly label?: string;
  /** Where that build wrote its records. Defaults to the user cache. */
  readonly cacheRoot?: string;
  /** The coverage index. Defaults to the repository-keyed user cache. */
  readonly coverageFile?: string;
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
   *
   * Returns the journey, so anything else that needs this execution named — the
   * `events` fixture, most of all — uses the one that is already on the context
   * rather than minting a second and overwriting the first.
   */
  readonly join: (page: Page, owner: string, origin?: string) => Promise<string | undefined>;
  /** Say whether this owner's tests finished; an incomplete owner never excludes. */
  readonly mark: (owner: string, complete: boolean) => void;
  /** Merge this worker's contribution into the index, or explain the silence. */
  readonly close: () => Promise<void>;
}

interface Accumulated {
  readonly hits: Map<ModuleId, Set<number>>;
  /** Of `hits`, the ordinals a module entered while evaluating: every spec's. */
  readonly shared: Map<ModuleId, Set<number>>;
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
  wire?: Wire,
): ExecutionRecorder {
  const root = resolve(recording.root ?? process.cwd());
  const owners = new Map<string, Accumulated>();
  const heads = recording.heads ?? [];
  const minted = new Map<string, string>();
  const failed = new Set<string>();
  const reports: JourneyReport[] = [];
  let seen = false;
  let instrumentation: string | undefined;
  let owned: Wire | undefined;
  let taking: Wire | undefined;

  // The medium is opened on the first execution that could use it, and only when
  // a head was named: a suite with one realm has nothing to reach it from
  // another process, and a listener nobody can find is a port for nothing.
  const takeReports = async (): Promise<Wire> => {
    const open = wire ?? (owned ??= await listen());
    if (taking !== open) {
      taking = open;
      open.on('journeys', (journey, body) => {
        if (journey === undefined) return;
        const report = journeyReportFrom(journey, body);
        if (report !== undefined) reports.push(report);
      });
    }
    return open;
  };

  return {
    note: async (page, owner) => {
      const journal = await drainExecution(page);
      if (journal === undefined) return;
      seen = true;
      instrumentation = journal.instrumentation;
      const accumulated = owners.get(owner) ?? { hits: new Map(), shared: new Map(), complete: true };
      for (const module of journal.modules) {
        const ordinals = accumulated.hits.get(module.id) ?? new Set<number>();
        for (const ordinal of module.hits) ordinals.add(ordinal);
        accumulated.hits.set(module.id, ordinals);
        const shared = accumulated.shared.get(module.id) ?? new Set<number>();
        for (const ordinal of module.shared) shared.add(ordinal);
        accumulated.shared.set(module.id, shared);
      }
      owners.set(owner, accumulated);
    },

    join: async (page, owner, origin) => {
      if (heads.length === 0) return undefined;
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
        return undefined;
      }
      const open = await takeReports();
      const journey = mintJourney();
      minted.set(journey, owner);
      // Both at one site, because they are one fact: this is the execution, and
      // this is where it answers. Written apart, whichever half a later mint
      // overwrote would leave a head reporting under an id nobody claims.
      await page.context().addCookies([
        { name: JOURNEY_COOKIE, value: journey, url },
        { name: RETURN_COOKIE, value: open.addressFor(journey), url },
      ]);
      return journey;
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
      try {
        await contribute();
      } finally {
        // Only a listener this recorder opened for itself: one it was handed
        // belongs to the worker, and closing somebody else's channel would take
        // the announcements down with the accounts.
        await owned?.close();
      }
    },
  };

  async function contribute(): Promise<void> {
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
    const stitched = stitchJourneys({
      reports,
      heads,
      owners: minted,
      preconditions,
      incomplete,
    });
    if (!stitched.complete) {
      process.stderr.write(`variance-authority: ${stitched.because}\n`);
    }

    const subjects: ObservedSubject[] = [];
    for (const [owner, accumulated] of owners) {
      subjects.push({
        owner,
        complete: accumulated.complete && stitched.complete,
        journal: {
          instrumentation: instrumentation!,
          modules: [...accumulated.hits].map(([id, ordinals]) => ({
            id,
            hits: [...ordinals],
            shared: [...(accumulated.shared.get(id) ?? [])],
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
      ...(recording.label === undefined ? {} : { label: recording.label }),
      ...(recording.cacheRoot === undefined ? {} : { cacheRoot: recording.cacheRoot }),
      ...(recording.coverageFile === undefined ? {} : { coverageFile: recording.coverageFile }),
      ...(stitched.heads.size === 0 ? {} : { heads: [...stitched.heads.keys()] }),
    });
    if (!record.recorded) {
      process.stderr.write(`variance-authority: recorded no test execution — ${record.because}\n`);
    }
  }
}
