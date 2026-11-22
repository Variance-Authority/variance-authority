import type { FreshCases, LaidRun } from './case-landing.js';
import type { ModuleId } from '../instrument/index.js';
import { native } from '../addon.js';
import type { CapturedModule } from './instrumented-modules.js';
import { caseKey, type CaseCoordinate } from './cases.js';
import type { RecordedAttempt } from './attempts-record.js';
import { triedAttempts, type CaseAttempts } from './case-attempts.js';
import { UNLIMITED, UNTIMED, type CaseDurations, type CaseLimits } from './case-durations.js';
import type { EyesSection } from './eyes-record.js';
import { nativeModule, whyAbsent } from './native-modules.js';
import type { Reading } from './readings.js';

/** A run's case journals, folded into the case index's bytes. */
export interface CaseFold {
  readonly bytes: Buffer;
  /** The number of times every journal was replayed: one per module slice. */
  readonly passes: number;
  /** Logical test-to-region pairs represented by the compact sets. */
  readonly crossings: number;
  /** How many cases the index names. */
  readonly cases: number;
  /** The cases that opened Eyes journals and what they handed over; absent when none did. */
  readonly eyes?: EyesSection;
  /** How each attempt of a retried case ended; absent when the runner's report counted no attempts. */
  readonly attempts?: readonly RecordedAttempt[];
}

/** What the runner reported beside the journals, and how much of the relation one slice holds. */
export interface CaseFoldOptions {
  /** Each case's duration as the runner reported it; absent, no case is timed. */
  readonly durations?: CaseDurations | undefined;
  /** Each case's limit, where the runner reports it only outside the case. */
  readonly limits?: CaseLimits | undefined;
  /** Each case's attempts as the runner reported them; absent, the run keeps none. */
  readonly tried?: CaseAttempts | undefined;
  /** Readings of files other than their own, joined into that file's record. */
  readonly readings?: ReadonlyMap<ModuleId, Reading>;
  /** Bytes of the test-by-region relation one module slice may hold. */
  readonly budget?: number;
}

/**
 * Fold the case journals in `directory` over `modules` into the case index's
 * bytes. The addon reads and replays the journals a module slice at a time
 * (`native/src/case_run.rs`); what only the runner knows — durations, limits,
 * attempts — is asked of the caller by each case it names. The fold itself runs
 * off the JavaScript thread, so a caller that starts it early overlaps it with
 * its own work and awaits it when the bytes are due.
 */
export async function foldCases(
  directory: string,
  root: string,
  modules: ReadonlyMap<ModuleId, CapturedModule>,
  options: CaseFoldOptions = {},
): Promise<CaseFold> {
  const open = native()?.openCaseJournals;
  if (open === undefined) throw new Error(`the case fold requires the Sense native addon: ${whyAbsent('openCaseJournals')}`);
  const journals = open(directory, root);
  const cases = journals.cases();
  const durations = options.durations ?? UNTIMED;
  const limits = options.limits ?? UNLIMITED;
  const shaped = [...modules].map(([id, module]) => ({ ...nativeModule(module), id }));
  const readings = [...(options.readings ?? new Map<ModuleId, Reading>())].map(([id, reading]) => ({
    id,
    target: reading.id,
    // `lands` is sparse, and `map` keeps a hole a hole: `Array.from` visits it.
    lands: Array.from(reading.lands, (land) => land ?? 0xFFFF_FFFF),
  }));
  const folding = journals.fold(
    shaped,
    [...modules.values()].map((module) => module.blocks.map((block) => block.ordinal)),
    readings,
    cases.map((held) => durations(held.file, held.name, held.runner) ?? Number.NaN),
    cases.map((held) => limits(held.file, held.name) ?? Number.NaN),
    options.budget,
  );
  const coordinates = cases.map((held): CaseCoordinate => ({
    file: held.file,
    name: held.name,
    id: held.runner,
    ...(held.project == null ? {} : { project: held.project }),
  }));
  const ids = new Map(coordinates.map((coordinate, at) => [caseKey(coordinate), cases[at]!.id]));
  const attempts = triedAttempts(coordinates, ids, options.tried, root);
  const looked = journals.eyes();
  const eyes: EyesSection | undefined = looked === null ? undefined : {
    watched: looked.watched,
    journals: looked.journals.map((row) => ({ case: row.case, attempt: row.attempt, journal: JSON.parse(row.journal) })),
  };
  const folded = await folding;
  return {
    bytes: folded.bytes,
    passes: folded.passes,
    crossings: folded.crossings,
    cases: cases.length,
    ...(eyes === undefined ? {} : { eyes }),
    ...(attempts === undefined ? {} : { attempts }),
  };
}

/**
 * A run's case journals as the case index a reporter lays into its record, or
 * `undefined` when the run has none to lay.
 *
 * The bounded fold is the writer: it reads the journals a slice at a time and
 * holds one relation per region, where materializing every case's crossings as
 * objects first cost the reporter 8.6 times the time and 20 times the heap on a
 * 200-case run over a thousand ambient modules — the heap arriving at the end
 * of a worker-heavy run, when the machine has least of it.
 *
 * A run that recorded no case and finished no test file has none, and leaves
 * the record's cases as they were. Absent is not empty: such a run — projects
 * that loaded none of this seam's modules, so no case wrote a frame and no file
 * wrote a journal — did not learn that no case walks any line. Laid over the
 * record anyway, it would name itself the last run with no case and put the
 * cases of every file it was handed in the before layer, as though it had
 * replaced them; laid where none was, it would answer *which cases walk this
 * line* with none.
 *
 * A file that finished did learn, even when none of its cases entered
 * anything: its cases walk no line, and what an earlier run recorded for them
 * is retired. The run already carries that answer — a test is `complete` only
 * when its file wrote a journal and ran to the end — so it is read from
 * `run.tests`, not worked out again from the case journals. The cases decide
 * and the modules do not: the fold keeps a module only when a case entered it.
 *
 * The fold arrives in flight: the caller starts {@link foldCases} as soon as
 * it holds the modules, and the run's own work goes on while the addon folds.
 * The caller hands the result to `landRun`, which lays it under the record's
 * lock in the same write as the coverage.
 */
export async function freshCases(folding: Promise<CaseFold>, run: LaidRun): Promise<FreshCases | undefined> {
  const folded = await folding;
  if (folded.cases === 0 && !run.tests.some((test) => test.complete)) return undefined;
  return {
    fresh: folded.bytes,
    run: {
      tests: run.tests,
      ...(run.commit === undefined ? {} : { commit: run.commit }),
      ...(folded.attempts === undefined ? {} : { attempts: folded.attempts }),
    },
    ...(folded.eyes === undefined ? {} : { eyes: folded.eyes }),
  };
}
