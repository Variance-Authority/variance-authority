// compass: variance-authority.reach
/**
 * Which mainline this checkout reads, left where every reader of a fetched
 * record looks: {@link noteSelectedMainline}.
 *
 * The selection needs the share's config and git, which only the CLI has, and
 * the rule that turns another mainline's record away is `lastFetchedMainline`'s,
 * below it. A read that does not go through `mainlineBase` asks this first, so
 * it is judged by the selection as it stands now.
 */

import { dirname } from 'node:path';
import type { RootConfig } from '@variance-authority/sense/test-selection';
import { parseShare } from '../config-share.js';
import { ConfigError } from '../config-values.js';
import { readerMainline } from '../share-lines.js';

/**
 * The root config's `share`, where a suite declared beside it is published.
 *
 * Read from the root file because that is where the suites are declared: the
 * CLI refuses a suite given to a share in a file with no `share` section.
 */
export function rootShare(config: RootConfig | undefined) {
  const value = config?.value['share'];
  if (config === undefined || value === undefined) return undefined;
  return parseShare(value, { source: config.file, baseDir: dirname(config.file) });
}

/**
 * Leave the mainline selected for `suite` beside this checkout's fetched
 * records. Nothing for a suite not given to the share, or a share section that
 * does not parse: that reader says so where it asks the share.
 */
export async function noteSelectedMainline(root: string, suite: string | undefined): Promise<void> {
  const selection = await import('@variance-authority/sense/test-selection');
  const declared = selection.declaredSuites(root);
  const name = suite ?? (declared?.length === 1 ? declared[0]!.name : undefined);
  if (name === undefined || declared?.find((one) => one.name === name)?.carry !== 'share') return;
  let share: ReturnType<typeof rootShare>;
  try {
    share = rootShare(selection.rootConfig(root));
  } catch (error) {
    if (error instanceof ConfigError) return;
    throw error;
  }
  const cacheRoot = selection.cacheRootFor(root);
  const chosen = await readerMainline(share === undefined ? {} : { share }, process.env, root);
  await keepSelected(selection.writeSelectedMainline, cacheRoot, name, 'missing' in chosen ? undefined : chosen.name);
}

/**
 * Best effort, as a miss's note is: a cache that cannot hold this could not
 * have kept a fetch to turn away, unless it was writable then.
 */
export async function keepSelected(
  write: (cacheRoot: string, suite: string, mainline: string | undefined) => Promise<void>,
  cacheRoot: string,
  suite: string,
  mainline: string | undefined,
): Promise<void> {
  try {
    await write(cacheRoot, suite, mainline);
  } catch {
    // Nothing to do: see above.
  }
}
