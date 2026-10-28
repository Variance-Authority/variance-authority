/**
 * The selection a run asks for through its environment.
 *
 * `VARIANCE_AUTHORITY_SINCE` turns selection on and means what `--since` means:
 * the base to measure from when the record names no commit of its own. Set and
 * empty, it turns selection on with no fallback base. `VARIANCE_AUTHORITY_AT_DISTANCE`
 * cuts the selection to one leg by import hops, as `--at-distance` does, and is
 * read only beside it. `VARIANCE_AUTHORITY_GRAIN=case` also skips, inside each
 * file that runs, the cases that ran none of the change; the file is the grain
 * otherwise. `VARIANCE_AUTHORITY_FAULT` selects the cases that entered the
 * region it skips ({@link faultSelection}).
 *
 * The reading is `selectSuite` from `@variance-authority/cli`, the function
 * `variance select` prints. It parses the execution journal through
 * `@variance-authority/distill`, which depends on this package, so it is not
 * imported here: it is resolved from the configuration's directory when the run
 * first asks, and a configuration that loads with neither variable set costs
 * nothing it did not cost before.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { recordedTimes } from '../recorded-durations.js';
import { distanceRange } from './at-distance.js';
import { FAULT_VARIABLE } from './cache-layers.js';
import { notingRead } from './record-base.js';
import type { SuiteSelection, SuiteTimes } from './suite-selection.js';

/** Where the selection is read: the checkout, whose record, and where the cli is installed. */
export interface SelectionRequest {
  readonly root: string;
  readonly suite?: string;
  /**
   * The directory the run's configuration is in, which is where the project
   * installs the cli: a package can hold it as its own devDependency under an
   * isolated install or Plug'n'Play, where the checkout's top does not resolve
   * it. The checkout when absent.
   */
  readonly from?: string;
  /**
   * The record this run lands in. A run with a region skipped reads its
   * selection from it, because that is the record its caller put in the cache
   * the run alone writes; the suite's nearest record otherwise.
   */
  readonly landing?: string;
}

/** What `@variance-authority/cli` is asked for; its own types stay on its side of the cycle. */
interface Selector {
  /** Absent from a cli older than faulted runs. */
  selectFault?(request: { readonly root: string; readonly suite?: string; readonly record?: string; readonly fault: string }): Promise<SuiteSelection>;
  selectSuite(request: {
    readonly root: string;
    readonly since?: string;
    readonly suite?: string;
    readonly atDistance?: { readonly from: number; readonly to: number };
    readonly grain?: 'case';
  }): Promise<SuiteSelection>;
  /** Absent from a cli older than placement by time. */
  suiteTimes?(request: { readonly root: string; readonly suite?: string }): Promise<SuiteTimes>;
}

const CLI = '@variance-authority/cli';

let toldDistance = false;

/**
 * What the run is handed, or `undefined` when the environment asks for no
 * selection. A distance that is not a range throws while the configuration
 * loads, so a typo fails the run rather than running another leg.
 */
export function selectionFrom(
  env: NodeJS.ProcessEnv,
  request: SelectionRequest,
  say: (line: string) => void = (line) => process.stderr.write(`${line}\n`),
): (() => Promise<SuiteSelection>) | undefined {
  const since = env['VARIANCE_AUTHORITY_SINCE'];
  const distance = env['VARIANCE_AUTHORITY_AT_DISTANCE'];
  const fault = env[FAULT_VARIABLE];
  if (fault !== undefined && fault !== '') return faultSelection(fault, since, request);
  if (since === undefined) {
    if (distance !== undefined && !toldDistance) {
      say('variance-authority: VARIANCE_AUTHORITY_AT_DISTANCE is read beside VARIANCE_AUTHORITY_SINCE, which is not set, so every file runs');
    }
    toldDistance ||= distance !== undefined;
    return undefined;
  }
  const grain = env['VARIANCE_AUTHORITY_GRAIN'];
  if (grain !== undefined && grain !== 'file' && grain !== 'case') {
    throw new Error(`VARIANCE_AUTHORITY_GRAIN=${grain} is not a grain: write \`case\` to skip the cases a change did not reach, or \`file\``);
  }
  const leg = distance === undefined ? undefined : distanceRange(distance);
  if (distance !== undefined && leg === undefined) {
    throw new Error(
      `VARIANCE_AUTHORITY_AT_DISTANCE=${distance} is not a range of hop counts: ` +
        'write `0-2` for everything within two imports, `2` for exactly two, or `3-` for the rest',
    );
  }
  return async () => {
    const { selectSuite } = await selector(request.from ?? request.root);
    return selectSuite({
      root: request.root,
      ...(since === '' ? {} : { since }),
      ...(request.suite === undefined ? {} : { suite: request.suite }),
      ...(leg === undefined ? {} : { atDistance: leg }),
      ...(grain === 'case' ? { grain } : {}),
    });
  };
}

/**
 * The cases that entered the region `fault` names (`fault.ts`), as the cli
 * reads them from the record the run starts from: the only cases that can
 * notice it skipped. It is not read beside a change.
 */
function faultSelection(fault: string, since: string | undefined, request: SelectionRequest): () => Promise<SuiteSelection> {
  if (since !== undefined) {
    throw new Error(`${FAULT_VARIABLE} selects the cases that entered the region it skips, so VARIANCE_AUTHORITY_SINCE is not read beside it: unset one`);
  }
  return async () => {
    const from = request.from ?? request.root;
    const { selectFault } = await selector(from, FAULT_VARIABLE);
    if (selectFault === undefined) {
      throw new Error(`${FAULT_VARIABLE} is set, and the ${CLI} ${from} resolves predates faulted runs: upgrade it`);
    }
    return selectFault({
      root: request.root,
      fault,
      ...(request.suite === undefined ? {} : { suite: request.suite }),
      ...(request.landing === undefined ? {} : { record: request.landing }),
    });
  };
}

/**
 * The suite's recorded times, read the first time a run under `--shard` asks.
 * A record named by file is read where it is; a suite's is read by the cli,
 * from where `variance select` reads it, this checkout's or the mainline's.
 *
 * An absence every shard sees alike is a reason rather than a failure — nothing
 * recorded, or a cli the configuration does not resolve or that predates the
 * times — and the shard is placed by file count, its line saying why. A read
 * that failed throws: another shard's may have answered, and the two would
 * place different files.
 */
export function timesFrom(request: SelectionRequest & { readonly recording?: string }): () => Promise<SuiteTimes> {
  return async () => {
    const from = request.from ?? request.root;
    try {
      if (request.recording !== undefined) return recordedTimes(request.recording);
      const cli = await installed(from);
      if (cli?.suiteTimes === undefined) {
        const why = cli === undefined ? `which ${from} does not resolve` : 'and the one installed predates them';
        return { unread: `the times are read by ${CLI}, ${why}` };
      }
      return await cli.suiteTimes({ root: request.root, ...(request.suite === undefined ? {} : { suite: request.suite }) });
    } catch (error) {
      throw new Error(
        'variance-authority: the times this shard is placed by could not be read, and a shard placed without them ' +
          `may take files another shard takes: ${error instanceof Error ? error.message : String(error)}`,
        { cause: error },
      );
    }
  };
}

async function installed(from: string): Promise<Selector | undefined> {
  let entry: string;
  try {
    entry = createRequire(resolve(from, 'package.json')).resolve(CLI);
  } catch {
    return undefined;
  }
  return (await import(pathToFileURL(entry).href)) as Selector;
}

/** `@variance-authority/cli` as the project installed it, or a refusal that names it. */
async function selector(from: string, variable = 'VARIANCE_AUTHORITY_SINCE'): Promise<Selector> {
  const cli = await installed(from);
  if (cli === undefined) {
    throw new Error(
      `${variable} is set, and the selection is read by ${CLI}, which ${from} does not resolve: ` +
        `add it to the project's devDependencies, or unset the variable to run every file`,
    );
  }
  return cli;
}

/**
 * The times a run landing in `landing` places its shard by, noted against that
 * record as its selection is, so the shard's record names the record it read.
 * A record the caller named by file is the one the run lands in, so its times
 * are read there; a suite's are read where `variance select` reads its record.
 */
export function landingTimes(
  landing: string,
  request: SelectionRequest & { readonly byFile: boolean },
): () => Promise<SuiteTimes> {
  const { byFile, ...asked } = request;
  return notingRead(landing, timesFrom({ ...asked, ...(byFile ? { recording: landing } : {}) }));
}
