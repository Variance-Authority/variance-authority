/**
 * What a Playwright run executed, recorded for the next run's selection.
 *
 * The instrument is the one `@variance-authority/sense` already uses; only the
 * transport differs, which is the rule
 * [spec 0028](https://github.com/Variance-Authority/variance-authority/blob/main/docs/specs/0028-the-instrument.md) states. The adopter's
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
  driveJourneys,
  joinObservations,
  listenForPreconditions,
  modulesEntered,
  preconditionOf,
  recordExecution,
  SAID_NOTHING,
  saidAcross,
  stageExecution,
  stagingDirectory,
  type CasePrecondition,
  type EvaluatingPage,
  type ObservedCase,
  type ObservedEyes,
  type ObservedSubject,
  type PreconditionStanding,
} from '@variance-authority/sense/journal';
import { stitchJourneys } from '@variance-authority/sense/journey';
import { repositoryRoot, type CoveragePrecondition } from '@variance-authority/sense/test-selection';
import type { Wire } from '@variance-authority/wire/listen';
import { resolve } from 'node:path';
import { absorb, accumulation, type Accumulated } from './accumulated.js';
import type { ExecutionRecording } from './execution-recording.js';
import { quietly } from './quiet.js';
import { reachedLines } from './reached-lines.js';
import { caseKey, ownerOf, type ObservedTest } from './test-coordinate.js';

export { ownerOf, testOf, type ObservedTest } from './test-coordinate.js';
export type { ExecutionRecording } from './execution-recording.js';

/** One worker's accumulation, drained per observation and written once. */
export interface ExecutionRecorder {
  /**
   * Take everything one document has entered since the last drain — a page's,
   * or any frame's, since the application is not always the top document.
   *
   * `subject` names the individual test the window belongs to, for a run
   * recording cases. Without it the crossings join the file and nothing finer,
   * which is what selection reads either way.
   *
   * `line` is the test line whose statement ran since the drain before, for a
   * case whose file was cut: each region the window holds that the case has
   * not reached under an earlier line is charged to it. A case drained without
   * one carries no lines, and a region drained without one before its first is
   * ambient.
   */
  readonly note: (page: EvaluatingPage, owner: string, subject?: ObservedTest, line?: number) => Promise<void>;
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
  readonly join: (
    page: Page,
    owner: string,
    origin?: string,
    subject?: ObservedTest,
  ) => Promise<string | undefined>;
  /**
   * The owner key for one test, against the root this recorder was given.
   *
   * Every half of the seam has to spell a file the same way or it is two
   * owners: one the crossings went to, one the verdict retired, and neither
   * complete. The root is the recorder's because the recorder is what writes,
   * and a configuration that set `root` meant it for the paths that land in
   * the index — not only for the ones the closing fold happens to compute.
   */
  readonly owner: (testInfo: TestInfo) => string;
  /**
   * Say whether this owner's tests finished; an incomplete owner never excludes.
   * With the test, the case carries it too, as whether its journey stopped.
   *
   * `duration` is the milliseconds Playwright counted for the attempt, as
   * `testInfo.duration` holds them when the test's fixtures tear down. The file
   * and the case each sum their attempts; nothing here reads a clock.
   */
  readonly mark: (owner: string, complete: boolean, subject?: ObservedTest, duration?: number) => void;
  /**
   * Keep one attempt's Eyes journal for its case, counted from 1, or without
   * one, that the attempt opened a journal. The record joins it to the case by
   * the id the index gives the case; see `case-scope.ts`.
   */
  readonly eyes: (owner: string, subject: ObservedTest, attempt: number, journal?: Readonly<Record<string, unknown>>) => void;
  /** What the case has said so far, or nothing where no listener runs; see `arranged.ts`. */
  readonly arranged: (owner: string, subject: ObservedTest) => readonly CasePrecondition[] | undefined;
  /** The checkout every path this recorder writes is named against. */
  readonly root: string;
  /** Merge this worker's contribution into the index, or explain the silence. */
  readonly close: () => Promise<void>;
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
  standing?: () => PreconditionStanding,
): ExecutionRecorder {
  const start = resolve(recording.root ?? process.cwd());
  const root = repositoryRoot(start);
  // What each case said it arranged, where a runner says where a call stands:
  // taken when the case is marked, which is after its `afterEach` ran.
  const listener = standing === undefined ? undefined : listenForPreconditions(root, standing);
  const heard = new Map<string, NonNullable<ObservedCase['said']>>();
  const owners = new Map<string, Accumulated>();
  // Kept beside the owners rather than derived from them: a case is a window
  // inside a file's window, and both are wanted whole. The key carries all
  // three coordinates because a test retried in the same worker drains twice
  // and is one case.
  const cases = new Map<string, { readonly of: Omit<ObservedCase, 'journal'>; readonly hits: Accumulated }>();
  // The line that first reached each region of a case, by the key `cases` uses.
  const reached = reachedLines();
  const heads = recording.heads ?? [];
  const minted = new Map<string, string>();
  // The case each journey was minted for, where the run records cases: a head
  // knows only the journey, so this is the one place its crossings meet a test.
  const mintedFor = new Map<string, { readonly owner: string; readonly subject: ObservedTest }>();
  const failed = new Set<string>();
  // How each case settled, by the key `cases` uses. A retry in the same worker
  // settles the case again, and one attempt that finished is a whole journey.
  const stopped = new Map<string, boolean>();
  // What the runner counted, per owner and per case key, summed over attempts.
  const spent = new Map<string, number>();
  // Each case's Eyes journals, one per attempt that handed one over.
  const looked = new Map<string, ObservedEyes[]>();
  const add = (key: string, duration: number): void => void spent.set(key, (spent.get(key) ?? 0) + duration);
  // The medium is opened on the first execution that could use it, and only when
  // a head was named: a suite with one realm has nothing to reach it from
  // another process, and a listener nobody can find is a port for nothing.
  const journeys = driveJourneys(wire);
  const reports = journeys.reports;
  let seen = false;
  let announced = false;
  let instrumentation: string | undefined;

  return {
    root,
    owner: (testInfo) => ownerOf(root, testInfo),
    arranged: (owner, subject) => listener?.held(caseKey(owner, subject.id)),
    eyes: (owner, subject, attempt, journal) => {
      caseOf(owner, subject);
      const key = caseKey(owner, subject.id);
      looked.set(key, [...(looked.get(key) ?? []), ...(journal === undefined ? [] : [{ attempt, journal }])]);
    },
    note: async (page, owner, subject, line) => {
      const journal = await quietly(page, () => drainExecution(page));
      if (journal === undefined) return;
      seen = true;
      instrumentation = journal.instrumentation;
      const accumulated = owners.get(owner) ?? accumulation();
      absorb(accumulated, journal);
      owners.set(owner, accumulated);
      if (subject === undefined) return;
      const held = caseOf(owner, subject);
      if (line !== undefined) reached.charge(caseKey(owner, subject.id), held, journal.modules, line);
      absorb(held, journal);
    },

    join: async (page, owner, origin, subject) => {
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
      const { journey, cookies } = await journeys.mint(url);
      minted.set(journey, owner);
      if (subject !== undefined) mintedFor.set(journey, { owner, subject });
      await page.context().addCookies([...cookies]);
      return journey;
    },

    mark: (owner, complete, subject, duration) => {
      if (duration !== undefined) add(owner, duration);
      if (subject !== undefined) {
        const key = caseKey(owner, subject.id);
        if (duration !== undefined) add(key, duration);
        const said = listener?.take(key);
        if (said !== undefined) {
          heard.set(key, saidAcross(heard.get(key), said).said!);
          // A case that only said something is still a case.
          caseOf(owner, subject);
        }
        stopped.set(key, stopped.get(key) === false ? false : !complete);
        // A case that stopped before the page had anything to drain is still a
        // case, and the one a reader most needs to hear about.
        if (!complete) caseOf(owner, subject);
      }
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
        listener?.close();
        await journeys.settled();
        await contribute();
      } finally {
        // Only a listener this recorder opened for itself: one it was handed
        // belongs to the worker, and closing somebody else's channel would take
        // the announcements down with the accounts.
        await journeys.close();
      }
    },
  };

  /** An accumulation as a journal again, which is what both records are made of. */
  function journalOf(accumulated: Accumulated) {
    return {
      instrumentation: instrumentation!,
      modules: modulesEntered(accumulated),
    };
  }

  /** One case's accumulation, made on first sight from whichever half saw it first. */
  function caseOf(owner: string, subject: ObservedTest): Accumulated {
    const key = `${owner}\u0000${subject.id}`;
    const held = cases.get(key) ?? {
      of: { file: owner, name: subject.name, id: subject.id, ...(subject.project === undefined ? {} : { project: subject.project }) },
      hits: accumulation(),
    };
    cases.set(key, held);
    return held.hits;
  }

  /** Every case this worker could name, as the index reads them. */
  function observedCases(): readonly ObservedCase[] {
    return [...cases].map(([key, held]) => {
      const settled = stopped.get(key);
      const duration = spent.get(key);
      const eyes = looked.get(key);
      const said = listener === undefined ? undefined : (heard.get(key) ?? SAID_NOTHING);
      const lines = reached.of(key);
      return {
        ...held.of,
        ...(said === undefined ? {} : { said }),
        ...(settled === undefined ? {} : { stopped: settled }),
        ...(duration === undefined ? {} : { duration }),
        ...(eyes === undefined ? {} : { eyes }),
        ...(lines === undefined ? {} : { lines }),
        journal: journalOf(held.hits),
      };
    });
  }

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
    // The same accounts joined a test finer, for the case index. What every
    // subject shares comes with each case, as the stitch folds it into each file.
    if (mintedFor.size > 0) {
      const keys = new Map([...mintedFor].map(([journey, { owner, subject }]) => [journey, `${owner}\u0000${subject.id}`]));
      const byKey = new Map([...mintedFor.values()].map((minted) => [`${minted.owner}\u0000${minted.subject.id}`, minted]));
      for (const subjects of stitchJourneys({ reports, heads, owners: keys }).heads.values()) {
        for (const { owner: key, journal } of subjects) {
          const { owner, subject } = byKey.get(key)!;
          instrumentation ??= journal.instrumentation;
          absorb(caseOf(owner, subject), journal);
        }
      }
    }

    const subjects: ObservedSubject[] = [];
    for (const [owner, accumulated] of owners) {
      subjects.push({
        owner,
        complete: accumulated.complete && stitched.complete,
        ...(spent.has(owner) ? { duration: spent.get(owner)! } : {}),
        journal: journalOf(accumulated),
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

    // A worker is one process of several and the index is one file, so a worker
    // that merged for itself would be writing a whole-run answer from a
    // fragment. The merge retires the previous crossings of every file whose
    // incoming row says it finished; two workers that each ran part of one spec
    // — `fullyParallel`, a second project, a shard, a retry that landed
    // elsewhere — would each write a finished-looking row and the later one
    // would drop the earlier one's regions. The spec is then recorded as fully
    // observed with half of what it walked, and the next `--since` skips it
    // over a line the other worker was in. So a run with the reporter installed
    // stages here and is folded once, by the process that saw all of it.
    const staging = stagingDirectory();
    if (staging !== undefined) {
      await stageExecution(staging, {
        subjects: joined,
        ...(cases.size === 0 ? {} : { cases: observedCases() }),
      });
      return;
    }
    // Said once, and only from inside a worker, which is the case the reporter
    // exists for: a process running by itself sees the whole run and merging
    // for itself is exactly right. Playwright names its workers in the
    // environment, so the difference is readable without asking the runner.
    // Without the reporter each worker merges the index on its own, and a spec
    // two of them shared keeps only the later half of what it walked.
    if (!announced && process.env.TEST_WORKER_INDEX !== undefined) {
      announced = true;
      process.stderr.write(
        'variance-authority: execution recording is on without its reporter; add ' +
          '`@variance-authority/playwright-test/reporter` to `reporter`, or a spec two workers ' +
          'shared keeps only the later worker\'s half.\n',
      );
    }
    const record = await recordExecution({
      root,
      subjects: joined,
      ...(recording.cacheRoot === undefined ? {} : { cacheRoot: recording.cacheRoot }),
      ...(recording.coverageFile === undefined ? {} : { coverageFile: resolve(start, recording.coverageFile) }),
      ...(recording.suite === undefined ? {} : { suite: recording.suite }),
      ...(recording.mode === undefined ? {} : { mode: recording.mode }),
      ...(recording.preconditions === undefined
        ? {}
        : { preconditions: recording.preconditions }),
      ...(cases.size === 0 ? {} : { cases: observedCases() }),
    });
    if (!record.recorded) {
      process.stderr.write(`variance-authority: recorded no test execution — ${record.because}\n`);
    }
  }
}
