/**
 * What each subject of a visual run executed, recorded for the next run's
 * selection.
 *
 * A collector drives one subject at a time — a story, a page — so a subject is
 * its own owner: its crossings belong to it and to nothing else. The page's
 * crossings are drained after each reading; a service beyond the page reports
 * what it ran under the subject's journey, and both are joined into one row per
 * subject at the end of the run.
 */

import { resolve } from 'node:path';
import type { InstrumentMode } from '../instrument/index.js';
import { drainExecution, type EvaluatingPage } from './drain.js';
import type { CoveragePrecondition } from './index.js';
import { recordExecution } from './journal.js';
import { driveJourneys, type JourneyCookie } from './journey-driver.js';
import { joinObservations, type ObservedCase, type ObservedSubject } from './observed.js';
import type { FilePhases } from './reported-time.js';
import { repositoryRoot } from './repository-root.js';
import { stitchJourneys } from './stitch.js';

/** Where a run's execution evidence is joined, read and kept. */
export interface SubjectRecording {
  /**
   * A directory inside the repository; defaults to the cwd. Recorded paths are
   * relative to the checkout it sits in, never to it.
   */
  readonly root?: string;
  /** Where the coverage layers live. Defaults to the repository's cache. */
  readonly cacheRoot?: string;
  /** Coverage index. Defaults to the repository-keyed cache the runner seams share. */
  readonly coverageFile?: string;
  /** The suite this run is, as the root `variance.config.json` declares it under `suites`. */
  readonly suite?: string;
  /**
   * The probe recipe the application was built with, matching
   * `testSelectionProbes()`'s `mode`. `presence` when absent, as it is there.
   */
  readonly mode?: InstrumentMode;
  /** Files whose contents are preconditions of every subject this run recorded. */
  readonly preconditions?: readonly string[];
  /**
   * Where this recording stands. Defaults to the checkout's `HEAD`, which is
   * the answer in every case except a caller that already knows better.
   */
  readonly commit?: string;
  /**
   * The services that report what each subject ran beyond the page, by the
   * head name each is started with (`VARIANCE_AUTHORITY_HEAD`). Every one named
   * must account for every request it said it served, or the run records
   * nothing it could narrow a later one by.
   */
  readonly heads?: readonly string[];
}

/** What one reading adds beyond the page's crossings. */
export interface SubjectNote {
  /** What the subject read that no crossing names: its own declaration, a document. */
  readonly preconditions?: readonly CoveragePrecondition[];
  /** The case this reading is, where the subject has a file to be a case in. */
  readonly case?: Omit<ObservedCase, 'journal' | 'stopped'>;
  /**
   * Where the driver saw this reading's time go. Where one subject is noted
   * twice, the run's join adds the readings, as it adds their durations.
   */
  readonly phases?: FilePhases;
}

/** One run's accumulation: a window per subject, written once at the end. */
export interface SubjectRecorder {
  /** The checkout every path this recorder writes is named against. */
  readonly root: string;
  /**
   * Mint the journey a subject's next reading runs under, as the cookies its
   * browser context carries to `origin`. None when the run names no heads.
   */
  readonly join: (subjectId: string, origin: string) => Promise<readonly JourneyCookie[]>;
  /**
   * Close one subject's window.
   *
   * `complete` is false for a subject this run refused. A refused subject still
   * executed code, so its crossings are kept — what it may never do is justify
   * excluding itself from a later run.
   */
  readonly note: (
    page: EvaluatingPage,
    subjectId: string,
    complete: boolean,
    noted?: SubjectNote,
  ) => Promise<void>;
  /**
   * Merge the run into the index, or say on stderr why it could not.
   *
   * `costs` is the run's own time for each subject, by subject id. It is
   * recorded as the subject's duration, on its row and on its case, rather
   * than timed a second time here.
   */
  readonly close: (costs?: ReadonlyMap<string, number>) => Promise<void>;
}

/** How the surface names itself in what it says on stderr. */
export interface SubjectSurface {
  /** `story`, `page`: what one subject is called. */
  readonly subject: string;
  /** Said when nothing the run drained had a collector in it. */
  readonly uninstrumented: string;
}

/**
 * Open one run's recorder: `join` before each subject is read, `note` after,
 * `close` once at the end.
 *
 * Nothing is written until `close`. A run in which no page reported what it
 * executed and no head was named writes nothing and says
 * `surface.uninstrumented` on stderr. A recording that fails is said on stderr
 * too and never fails the run, whose baselines are the work that matters.
 */
export function createSubjectRecorder(
  surface: SubjectSurface,
  options: SubjectRecording = {},
): SubjectRecorder {
  const ran = resolve(options.root ?? process.cwd());
  const root = repositoryRoot(ran);
  const heads = options.heads ?? [];
  const journeys = heads.length === 0 ? undefined : driveJourneys();
  const minted = new Map<string, string>();
  // What each subject declared and whether it finished, kept apart from the
  // page's journal: a head may have run a subject the page drained nothing of.
  const declared = new Map<string, Map<string, CoveragePrecondition>>();
  const refused = new Set<string>();
  const observed: ObservedSubject[] = [];
  // Each case with the subject it was noted for, so the run's time finds it.
  const cases: { readonly subject: string; readonly observed: ObservedCase }[] = [];
  let seen = false;

  return {
    root,
    join: async (subjectId, origin) => {
      if (journeys === undefined) return [];
      const { journey, cookies } = await journeys.mint(origin);
      minted.set(journey, subjectId);
      return cookies;
    },

    note: async (page, subjectId, complete, noted = {}) => {
      if (!complete) refused.add(subjectId);
      if (noted.preconditions !== undefined) {
        const held = declared.get(subjectId) ?? new Map<string, CoveragePrecondition>();
        for (const precondition of noted.preconditions) held.set(precondition.name, precondition);
        declared.set(subjectId, held);
      }
      const journal = await drainExecution(page);
      if (journal === undefined) return;
      seen = true;
      // FIXME: what the page read (`journal.read`) is laid on no subject, where
      // spec 0102 lays a page read on the case driving the page.
      observed.push({
        owner: subjectId,
        journal,
        complete,
        ...(noted.preconditions === undefined ? {} : { preconditions: noted.preconditions }),
        ...(noted.phases === undefined ? {} : { phases: noted.phases }),
      });
      if (noted.case !== undefined) {
        cases.push({ subject: subjectId, observed: { ...noted.case, stopped: !complete, journal } });
      }
    },

    close: async (costs) => {
      try {
        await journeys?.settled();
        await contribute(costs);
      } finally {
        await journeys?.close();
      }
    },
  };

  async function contribute(costs: ReadonlyMap<string, number> | undefined): Promise<void> {
    if (!seen && heads.length === 0) {
      process.stderr.write(`variance-authority: ${surface.uninstrumented}\n`);
      return;
    }
    const timed = zip(observed, timedOnce(observed.map((one) => one.owner), costs));
    let subjects: readonly ObservedSubject[] = timed;
    if (journeys !== undefined) {
      const preconditions = new Map([...declared].map(([owner, held]) => [owner, [...held.values()]]));
      const stitched = stitchJourneys({
        reports: journeys.reports,
        heads,
        owners: minted,
        preconditions,
        incomplete: refused,
      });
      if (!stitched.complete) process.stderr.write(`variance-authority: ${stitched.because}\n`);
      subjects = joinObservations([
        timed.map((subject) => ({ ...subject, complete: subject.complete !== false && stitched.complete })),
        ...stitched.heads.values(),
      ]);
    }
    // A refusal is written and the run continues. Recording is an addition to
    // a visual run: losing it costs the *next* selection its narrowing, which
    // is a full suite — the safe direction — while failing the run over it
    // would cost this one its baselines, which is not.
    //
    // That holds for a throw as much as for a refusal. The recorder reports
    // what it declined in `because`, but it is a file format, a lock and a
    // filesystem underneath, and any of them can raise something it has no
    // sentence for. Letting that escape ends the run *after* every subject
    // has been rendered and compared — the most expensive possible moment to
    // lose a set of baselines, and over the half of the work that was only
    // ever an addition.
    let record: Awaited<ReturnType<typeof recordExecution>>;
    try {
      record = await recordExecution({
        root,
        subjects,
        ...(options.cacheRoot === undefined ? {} : { cacheRoot: options.cacheRoot }),
        // Against `root`, as the runner seams resolve them, never the checkout.
        ...(options.coverageFile === undefined ? {} : { coverageFile: resolve(ran, options.coverageFile) }),
        ...(options.suite === undefined ? {} : { suite: options.suite }),
        ...(options.mode === undefined ? {} : { mode: options.mode }),
        ...(options.preconditions === undefined ? {} : { preconditions: options.preconditions }),
        ...(options.commit === undefined ? {} : { commit: options.commit }),
        ...(cases.length === 0
          ? {}
          : {
              cases: zip(
                cases.map((one) => one.observed),
                timedOnce(cases.map((one) => one.subject), costs),
              ),
            }),
      });
    } catch (error) {
      process.stderr.write(
        `variance-authority: recorded no ${surface.subject} execution — the recorder failed with ` +
          `${error instanceof Error ? error.message : String(error)}; this run is ` +
          'unaffected and the next `--since` will run everything\n',
      );
      return;
    }
    if (!record.recorded) {
      process.stderr.write(`variance-authority: recorded no ${surface.subject} execution — ${record.because}\n`);
    }
  }
}

/**
 * The run's time for each noted subject, given to the first note of that
 * subject only.
 *
 * A subject read again — once more in the same world, once alone — is noted
 * each time, and the record sums what its entries carry; the run's time
 * already covers every reading, from the first collection to the decision.
 */
function timedOnce(
  subjects: readonly string[],
  costs: ReadonlyMap<string, number> | undefined,
): { readonly duration?: number }[] {
  const given = new Set<string>();
  return subjects.map((subject) => {
    const duration = costs?.get(subject);
    if (duration === undefined || given.has(subject)) return {};
    given.add(subject);
    return { duration };
  });
}

function zip<T>(entries: readonly T[], timed: readonly { readonly duration?: number }[]): T[] {
  return entries.map((entry, index) => ({ ...entry, ...timed[index] }));
}
