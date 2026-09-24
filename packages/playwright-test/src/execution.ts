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
  stageExecution,
  stagingDirectory,
  type EvaluatingPage,
  type ExecutedModule,
  type InstrumentMode,
  type ModuleId,
  type ObservedCase,
  type ObservedSubject,
} from '@variance-authority/sense/journal';
import {
  journeyReportFrom,
  mintJourney,
  stitchJourneys,
  unsettledScopes,
  type JourneyReport,
} from '@variance-authority/sense/journey';
import { repositoryRoot, type CoveragePrecondition } from '@variance-authority/sense/test-selection';
import { JOURNEY_COOKIE, RETURN_COOKIE } from '@variance-authority/wire';
import { listen, type Wire } from '@variance-authority/wire/listen';
import { relative, resolve, sep } from 'node:path';

/** Where the index and the block records live, when the defaults are wrong. */
export interface ExecutionRecording {
  /**
   * A directory inside the repository; defaults to the cwd. Recorded paths are
   * relative to the checkout it sits in, never to it.
   */
  readonly root?: string;
  /** Matches the `label` given to `testSelectionProbes()`. Defaults to `build`. */
  readonly label?: string;
  /** Where that build wrote its records. Defaults to the repository's cache. */
  readonly cacheRoot?: string;
  /** The coverage index. Defaults to the repository's cache. */
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
  /**
   * Also record which individual test entered which region, not only which
   * spec file.
   *
   * Off by default and worth leaving off for most suites. Selection does not
   * use it — the runner's unit of execution is the spec file, so a distinction
   * finer than that is one no `--since` could spend. What it is for is the
   * question asked *of* a line rather than of a commit: which tests walk this
   * branch, which `variance covering` and `@variance-authority/distill`
   * answer. It is a row per test per region, so a suite that writes one to
   * answer a question nobody asks has bought a large file and nothing else.
   *
   * Turning it on needs the reporter, like everything else this seam writes:
   * the index is folded once, by the process that saw the whole run.
   */
  readonly cases?: boolean;
  /**
   * Where that index goes, for the worker that has no reporter to fold it.
   * Defaults beside the snapshot: `<coverage file>.cases.bin`; a name ending
   * `.json` is written as JSON instead, at the size JSON costs.
   */
  readonly executionFile?: string;
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
}

/** One worker's accumulation, drained per observation and written once. */
export interface ExecutionRecorder {
  /**
   * Take everything one document has entered since the last drain — a page's,
   * or any frame's, since the application is not always the top document.
   *
   * `subject` names the individual test the window belongs to, for a run
   * recording cases. Without it the crossings join the file and nothing finer,
   * which is what selection reads either way.
   */
  readonly note: (page: EvaluatingPage, owner: string, subject?: ObservedTest) => Promise<void>;
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
  /** Say whether this owner's tests finished; an incomplete owner never excludes. */
  readonly mark: (owner: string, complete: boolean) => void;
  /** Merge this worker's contribution into the index, or explain the silence. */
  readonly close: () => Promise<void>;
}

/** Which test a window belongs to, where the run is recording that. */
export interface ObservedTest {
  /** The declaration path inside the spec file, as a person reads it. */
  readonly name: string;
  /** Stable across retries, so a flake and its retry are one case read twice. */
  readonly id: string;
}

/**
 * Where a test is declared, as the execution index names it.
 *
 * Playwright's own `titlePath` opens with the project and the file, which the
 * index already holds as the owner; what is left is the path a person reads in
 * the report, and the one a `describe` in a diff moves.
 */
export function testOf(testInfo: TestInfo): ObservedTest {
  const path = [...testInfo.titlePath];
  if (path[0] === testInfo.project.name) path.shift();
  if (path[0] !== undefined && testInfo.file.endsWith(path[0])) path.shift();
  return { name: path.join(' > '), id: testInfo.testId };
}

interface Accumulated {
  readonly hits: Map<ModuleId, Set<number>>;
  /** Of `hits`, the ordinals a module entered while evaluating: every spec's. */
  readonly shared: Map<ModuleId, Set<number>>;
  complete: boolean;
}

/** How long a worker waits at its end for requests a head is still serving. */
const SETTLING_MS = 5_000;

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
  const start = resolve(recording.root ?? process.cwd());
  const root = repositoryRoot(start);
  const owners = new Map<string, Accumulated>();
  // Kept beside the owners rather than derived from them: a case is a window
  // inside a file's window, and both are wanted whole. The key carries all
  // three coordinates because a test retried in the same worker drains twice
  // and is one case.
  const cases = new Map<string, { readonly of: Omit<ObservedCase, 'journal'>; readonly hits: Accumulated }>();
  const heads = recording.heads ?? [];
  const minted = new Map<string, string>();
  // The case each journey was minted for, where the run records cases: a head
  // knows only the journey, so this is the one place its crossings meet a test.
  const mintedFor = new Map<string, { readonly owner: string; readonly subject: ObservedTest }>();
  const failed = new Set<string>();
  const reports: JourneyReport[] = [];
  let seen = false;
  let announced = false;
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
    owner: (testInfo) => ownerOf(root, testInfo),
    note: async (page, owner, subject) => {
      const journal = await drainExecution(page);
      if (journal === undefined) return;
      seen = true;
      instrumentation = journal.instrumentation;
      const accumulated = owners.get(owner) ?? { hits: new Map(), shared: new Map(), complete: true };
      absorb(accumulated, journal);
      owners.set(owner, accumulated);
      if (recording.cases !== true || subject === undefined) return;
      absorb(caseOf(owner, subject), journal);
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
      const open = await takeReports();
      const journey = mintJourney();
      minted.set(journey, owner);
      if (recording.cases === true && subject !== undefined) mintedFor.set(journey, { owner, subject });
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
        await settled();
        await contribute();
      } finally {
        // Only a listener this recorder opened for itself: one it was handed
        // belongs to the worker, and closing somebody else's channel would take
        // the announcements down with the accounts.
        await owned?.close();
      }
    },
  };

  /**
   * Wait for every request a head said it was still serving, up to a bound.
   *
   * A spec is over when its page is, and a handler's scope is over when what it
   * returned settles: a streamed body or a write behind outlives the response
   * that ended the test. Nothing is waited on when nothing is open, and what is
   * still open at the bound is named by the stitch and retires the run.
   */
  async function settled(): Promise<void> {
    const deadline = Date.now() + SETTLING_MS;
    while (unsettledScopes(reports).size > 0 && Date.now() < deadline) {
      await new Promise((settle) => setTimeout(settle, 10));
    }
  }

  /** Fold one drained window into an accumulation, keeping evaluation apart. */
  function absorb(accumulated: Accumulated, journal: { modules: readonly ExecutedModule[] }): void {
    for (const module of journal.modules) {
      const ordinals = accumulated.hits.get(module.id) ?? new Set<number>();
      for (const ordinal of module.hits) ordinals.add(ordinal);
      accumulated.hits.set(module.id, ordinals);
      const shared = accumulated.shared.get(module.id) ?? new Set<number>();
      for (const ordinal of module.shared) shared.add(ordinal);
      accumulated.shared.set(module.id, shared);
    }
  }

  /** An accumulation as a journal again, which is what both records are made of. */
  function journalOf(accumulated: Accumulated) {
    return {
      instrumentation: instrumentation!,
      modules: [...accumulated.hits].map(([id, ordinals]) => ({
        id,
        hits: [...ordinals],
        shared: [...(accumulated.shared.get(id) ?? [])],
      })),
    };
  }

  /** One case's accumulation, made on first sight from whichever half saw it first. */
  function caseOf(owner: string, subject: ObservedTest): Accumulated {
    const key = `${owner}\u0000${subject.id}`;
    const held = cases.get(key) ?? {
      of: { file: owner, name: subject.name, id: subject.id },
      hits: { hits: new Map(), shared: new Map(), complete: true },
    };
    cases.set(key, held);
    return held.hits;
  }

  /** Every case this worker could name, as the index reads them. */
  function observedCases(): readonly ObservedCase[] {
    return [...cases.values()].map((held) => ({ ...held.of, journal: journalOf(held.hits) }));
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
        ...(stitched.heads.size === 0 ? {} : { heads: [...stitched.heads.keys()] }),
        ...(cases.size === 0 ? {} : { cases: observedCases() }),
      });
      return;
    }
    // Said once, and only from inside a worker, which is the case the reporter
    // exists for: a process running by itself sees the whole run and merging
    // for itself is exactly right. Playwright names its workers in the
    // environment, so the difference is readable without asking the runner.
    if (!announced && process.env.TEST_WORKER_INDEX !== undefined) {
      announced = true;
      process.stderr.write(
        'variance-authority: execution recording is on without the reporter that folds it — ' +
          'add `@variance-authority/playwright-test/reporter` to `reporter` in this ' +
          "project's configuration. Without it each worker merges the index on its own, " +
          'and a spec two of them shared keeps only the later half of what it walked\n',
      );
    }
    const record = await recordExecution({
      root,
      subjects: joined,
      ...(recording.label === undefined ? {} : { label: recording.label }),
      ...(recording.cacheRoot === undefined ? {} : { cacheRoot: recording.cacheRoot }),
      ...(recording.coverageFile === undefined ? {} : { coverageFile: resolve(start, recording.coverageFile) }),
      ...(recording.mode === undefined ? {} : { mode: recording.mode }),
      ...(recording.preconditions === undefined
        ? {}
        : { preconditions: recording.preconditions }),
      ...(stitched.heads.size === 0 ? {} : { heads: [...stitched.heads.keys()] }),
      ...(cases.size === 0 ? {} : { cases: observedCases() }),
      ...(recording.executionFile === undefined
        ? {}
        : { executionFile: resolve(start, recording.executionFile) }),
    });
    if (!record.recorded) {
      process.stderr.write(`variance-authority: recorded no test execution — ${record.because}\n`);
    }
  }
}
