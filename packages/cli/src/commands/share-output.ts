import type { Config } from '../config.js';
import { OperatorError } from '../exit.js';
import { reportsFor } from './report-read.js';
import { shareLines, type Here } from './share.js';
import { publishComposed, refuseMissingShards } from './suite-part.js';

/**
 * `variance share`: a lookup, one report published, or every shard's.
 *
 * Several reports are one sharded build, and they publish the index composed
 * from all of their parts and the costs of the merged report. One report
 * publishes itself, as an unsharded build does from its own run; one shard
 * named alone is refused as `report` refuses it, since the rest are missing.
 */
export async function shareOutput(
  config: Config,
  options: { readonly publish: boolean; readonly mainline?: string; readonly reports: readonly string[] },
  here: Here = {},
): Promise<readonly string[]> {
  const [only, ...more] = options.reports;
  // A report is only an input to the publishing direction. Accepting one while
  // fetching would read as "look this up as of that run", which is not what
  // the mainline is read from and never will be.
  if (!options.publish && only !== undefined) throw new OperatorError('`share <report>` is for `--publish`; a lookup takes `--mainline`');
  if (!options.publish) {
    return shareLines(config, { publish: false, ...(options.mainline === undefined ? {} : { mainline: options.mainline }) }, here);
  }
  if (more.length === 0) {
    if (only !== undefined) await refuseMissingShards([only]);
    return shareLines(config, { publish: true, ...(only === undefined ? {} : { report: only }) }, here);
  }
  return publishComposed(config, options.reports, await reportsFor(options.reports, config), here);
}
