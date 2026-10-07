/**
 * The selection a run asks for through its environment.
 *
 * `VARIANCE_AUTHORITY_SINCE` turns selection on and means what `--since` means:
 * the base to measure from when the record names no commit of its own. Set and
 * empty, it turns selection on with no fallback base. `VARIANCE_AUTHORITY_AT_DISTANCE`
 * cuts the selection to one leg by import hops, as `--at-distance` does, and is
 * read only beside it.
 *
 * The reading is `selectSuite` from `@variance-authority/cli`, the function
 * `variance select` prints. It parses the execution journal through
 * `@variance-authority/distill`, which depends on this package, so it is not
 * imported here: it is resolved from the checkout when the run first asks, and
 * a configuration that loads with neither variable set costs nothing it did not
 * cost before.
 */

// compass: variance-authority.reach

import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { distanceRange } from './at-distance.js';
import type { SuiteSelection } from './suite-selection.js';

/** Where the selection is read: the checkout, and whose record. */
export interface SelectionRequest {
  readonly root: string;
  readonly suite?: string;
}

/** What `@variance-authority/cli` is asked for; its own types stay on its side of the cycle. */
interface Selector {
  selectSuite(request: {
    readonly root: string;
    readonly since?: string;
    readonly suite?: string;
    readonly atDistance?: { readonly from: number; readonly to: number };
  }): Promise<SuiteSelection>;
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
  const leg = distance === undefined ? undefined : distanceRange(distance);
  if (distance !== undefined && leg === undefined) {
    throw new Error(
      `VARIANCE_AUTHORITY_AT_DISTANCE=${distance} is not a range of hop counts: ` +
        'write `0-2` for everything within two imports, `2` for exactly two, or `3-` for the rest',
    );
  }
  return async () => {
    const { selectSuite } = await selector(request.root);
    return selectSuite({
      root: request.root,
      ...(since === '' ? {} : { since }),
      ...(request.suite === undefined ? {} : { suite: request.suite }),
      ...(leg === undefined ? {} : { atDistance: leg }),
    });
  };
}

/** `@variance-authority/cli` as the checkout installed it, or a refusal that names it. */
async function selector(root: string): Promise<Selector> {
  let entry: string;
  try {
    entry = createRequire(resolve(root, 'package.json')).resolve(CLI);
  } catch {
    throw new Error(
      `VARIANCE_AUTHORITY_SINCE is set, and the selection is read by ${CLI}, which ${root} does not resolve: ` +
        `add it to the project's devDependencies, or unset the variable to run every file`,
    );
  }
  return (await import(pathToFileURL(entry).href)) as Selector;
}
