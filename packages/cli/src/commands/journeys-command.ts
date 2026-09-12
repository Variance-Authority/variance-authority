import {
  formatJourneys,
  formatLanding,
  journeysOf,
  type JourneyPool,
} from './journeys.js';
import { landJourneys } from './land.js';
import { recordedJourneys } from './resources.js';
import { subjectsInReport } from './run-report.js';

/** What `variance journeys` was asked for, once the flags are off the command line. */
export interface JourneysRequest {
  readonly cwd: string;
  /** Where the run's own report is, for the subjects a reading is narrowed to. */
  readonly report: string;
  /** Every recorded subject rather than this run's. */
  readonly all: boolean;
  /** Shard directories to land before anything is read. */
  readonly shards: readonly string[];
  readonly into?: string;
  readonly file?: string;
  readonly limit?: number;
}

/**
 * Land, then read, then say it — in that order, and the order is the point.
 *
 * Shards land first so the reading is of the suite and not of the slice this
 * machine last ran, and a write that happened is reported before anything is
 * concluded from it. The pool is chosen before the snapshot is read, because the
 * instrument narrows on the way out: `journeyDivergences` decides who is
 * entitled to be missing from a region, and a filter applied afterwards would be
 * a filter over an answer somebody else's subjects had already shaped.
 */
export async function journeysOutput(request: JourneysRequest): Promise<string> {
  const landed =
    request.shards.length === 0
      ? undefined
      : await landJourneys(request.cwd, request.shards, request.into);

  const named = request.all ? undefined : await subjectsInReport(request.report);
  const pool: JourneyPool = request.all
    ? { kind: 'all' }
    : named === undefined
      ? { kind: 'unasked', report: request.report }
      : { kind: 'run', named: named.length };

  const reading = formatJourneys(
    journeysOf({
      ...(await recordedJourneys(request.cwd, named, landed?.at)),
      pool,
      ...(request.file !== undefined ? { file: request.file } : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
    }),
  );

  return `${landed === undefined ? '' : `${formatLanding(landed)}\n\n`}${reading}\n`;
}
