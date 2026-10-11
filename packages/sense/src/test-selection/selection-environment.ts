/**
 * The selection a run asks for through its environment.
 *
 * `VARIANCE_AUTHORITY_SINCE` turns selection on and means what `--since` means:
 * the base to measure from when the record names no commit of its own. Set and
 * empty, it turns selection on with no fallback base. `VARIANCE_AUTHORITY_AT_DISTANCE`
 * cuts the selection to one leg by import hops, as `--at-distance` does, and is
 * read only beside it. `VARIANCE_AUTHORITY_GRAIN=case` also skips, inside each
 * file that runs, the cases that ran none of the change; the file is the grain
 * otherwise.
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
}

/** What `@variance-authority/cli` is asked for; its own types stay on its side of the cycle. */
interface Selector {
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
 * The suite's recorded times, read the first time a run under `--shard` asks.
 * A record named by file is read where it is; a suite's is read by the cli,
 * from where `variance select` reads it, this checkout's or the mainline's.
 * A cli the configuration does not resolve is a reason rather than a failure:
 * the runner can still cut the shard by count, and the line it prints says why.
 */
export function timesFrom(request: SelectionRequest & { readonly recording?: string }): () => Promise<SuiteTimes> {
  return async () => {
    if (request.recording !== undefined) return recordedTimes(request.recording);
    const from = request.from ?? request.root;
    try {
      const cli = await installed(from);
      if (cli?.suiteTimes === undefined) {
        const why = cli === undefined ? `which ${from} does not resolve` : 'and the one installed predates them';
        return { unread: `the times are read by ${CLI}, ${why}` };
      }
      return await cli.suiteTimes({ root: request.root, ...(request.suite === undefined ? {} : { suite: request.suite }) });
    } catch (error) {
      return { unread: error instanceof Error ? error.message : String(error) };
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
async function selector(from: string): Promise<Selector> {
  const cli = await installed(from);
  if (cli === undefined) {
    throw new Error(
      `VARIANCE_AUTHORITY_SINCE is set, and the selection is read by ${CLI}, which ${from} does not resolve: ` +
        `add it to the project's devDependencies, or unset the variable to run every file`,
    );
  }
  return cli;
}
