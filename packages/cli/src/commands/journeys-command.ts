import {
  formatJourneys,
  formatLanding,
  journeysOf,
  type JourneyPool,
} from './journeys.js';
import { EXIT_CLEAN, type ExitCode } from '../exit.js';
import type { Parsed } from '../parse.js';
import { landJourneys } from './land.js';
import { recordedJourneys } from './resources.js';
import { subjectsInReport } from './run-report.js';
import { collectedIn } from './suite-share.js';
import { landingRecord, suiteRecord } from './suite-record.js';

/** What `variance journeys` was asked for, once the flags are off the command line. */
export interface JourneysRequest {
  readonly cwd: string;
  /**
   * Where the run's own report is, for the subjects a reading is narrowed to;
   * absent under `--suite`, which reads no project config and so has no report.
   */
  readonly report?: string;
  /** Every recorded subject rather than this run's. */
  readonly all: boolean;
  /** Shard directories to land before anything is read. */
  readonly shards: readonly string[];
  readonly into?: string;
  /** The runner's list of the files the suite collects, which the landing keeps the record's test files to. */
  readonly collected?: string;
  /** Whose record is read and landed on, when more than one suite is declared. */
  readonly suite?: string;
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
  // Shards land on this checkout's own layer; with none to land, the reading
  // is of the nearest layer that holds a record.
  const landed =
    request.shards.length === 0
      ? undefined
      : await landJourneys(
          request.cwd,
          request.shards,
          request.into ?? (await landingRecord(request.cwd, request.suite)),
          request.collected === undefined ? undefined : await collectedIn(request.cwd, request.collected),
        );
  const record = landed?.at ?? request.into ?? (await suiteRecord(request.cwd, request.suite));

  const named = request.all || request.report === undefined ? undefined : await subjectsInReport(request.report);
  const pool: JourneyPool = request.all
    ? { kind: 'all' }
    : named === undefined
      ? { kind: 'unasked', ...(request.report !== undefined ? { report: request.report } : {}) }
      : { kind: 'run', named: named.length };

  const reading = formatJourneys(
    journeysOf({
      ...(await recordedJourneys(request.cwd, named, record)),
      pool,
      ...(request.file !== undefined ? { file: request.file } : {}),
      ...(request.limit !== undefined ? { limit: request.limit } : {}),
    }),
  );

  return `${landed === undefined ? '' : `${formatLanding(landed)}\n\n`}${reading}\n`;
}

/** The reading `variance journeys` takes, without a fold-only operation. */
type JourneysCommand = Extract<Parsed, { command: 'journeys'; operation?: undefined }>;

/**
 * `variance journeys`, with the project config's report when one was read.
 *
 * `--suite` reads no project config: the root config declares the suite, and a
 * repository that runs only a unit suite has no visual project to configure.
 */
export async function runJourneys(
  parsed: JourneysCommand,
  streams: { out(text: string): void },
  report?: string,
): Promise<ExitCode> {
  streams.out(
    await journeysOutput({
      cwd: process.cwd(),
      ...(report !== undefined ? { report } : {}),
      all: parsed.all,
      shards: parsed.shards,
      ...(parsed.into !== undefined ? { into: parsed.into } : {}),
      ...(parsed.collected !== undefined ? { collected: parsed.collected } : {}),
      ...(parsed.suite !== undefined ? { suite: parsed.suite } : {}),
      ...(parsed.file !== undefined ? { file: parsed.file } : {}),
      ...(parsed.limit !== undefined ? { limit: parsed.limit } : {}),
    }),
  );

  // `changelog`'s rule. A parting is where to look, not a verdict: every
  // suite with two stories per component has them legitimately, and a
  // command that gated on one would be red on every healthy project.
  return EXIT_CLEAN;
}
