// compass: variance-authority.reach
/**
 * Which mainline this checkout reads: {@link selectMainline}.
 *
 * The selection needs the share's config and git, which only the CLI has, and
 * the rule that turns another mainline's record away is `lastFetchedMainline`'s,
 * below it. A read that works the selection out hands it to that rule.
 */

import { stat } from 'node:fs/promises';
import { dirname } from 'node:path';
import type { DeclaredSuite, RecordOrigin, RootConfig } from '@variance-authority/sense/test-selection';
import { parseShare } from '../config-share.js';
import { ConfigError } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { readerMainline, type Env, type ReaderMainline } from '../share-lines.js';

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

/** What {@link selectMainline} worked out, and the share and cache it asked. */
export interface MainlineSelection {
  readonly share: ReturnType<typeof rootShare>;
  readonly cacheRoot: string;
  /** The mainline chosen, with `HEAD`'s merge base with it. Absent when none could be. */
  readonly named?: Exclude<ReaderMainline, { missing: unknown }>;
}

/**
 * The mainline selected for this checkout. `unconfigured` is a share section
 * that does not parse. An unset token is not one of these: it is read when the
 * share is asked, and arrives as that share's miss.
 */
export async function selectMainline(
  root: string,
  here: { readonly env?: Env; readonly cacheRoot?: string } = {},
): Promise<MainlineSelection | { readonly unconfigured: string }> {
  const selection = await import('@variance-authority/sense/test-selection');
  let share: ReturnType<typeof rootShare>;
  try {
    share = rootShare(selection.rootConfig(root));
  } catch (error) {
    if (!(error instanceof ConfigError)) throw error;
    return { unconfigured: error.message };
  }
  const cacheRoot = here.cacheRoot ?? selection.cacheRootFor(root);
  const chosen = await readerMainline(share === undefined ? {} : { share }, here.env ?? process.env, root);
  const named = 'missing' in chosen ? undefined : chosen;
  return { share, cacheRoot, ...(named === undefined ? {} : { named }) };
}

/**
 * {@link selectMainline} for a read that goes to a fetched record without
 * `mainlineBase`: the mainline's name, to hand it. Nothing when none was chosen
 * or for a suite not given to the share. `null` for a share section that does
 * not parse, so nothing fetched answers, which that reader says where it asks
 * the share. `declared` is the suite as the caller resolved it.
 */
export async function selectedMainline(root: string, declared: DeclaredSuite | undefined): Promise<string | null | undefined> {
  if (declared?.carry !== 'share') return undefined;
  const selected = await selectMainline(root);
  return 'unconfigured' in selected ? null : selected.named?.name;
}

/**
 * Whether the journal is on disk, distinguishing *missing* from *unreadable*.
 *
 * Anything other than ENOENT is handed on: a directory in its place, a
 * permission the operator lost, a mount that went away. Reporting those as "no
 * recording here" would be the one failure this whole subsystem is written to
 * refuse — a run that ignored a snapshot looking exactly like a run that never
 * had one.
 */
export async function recordHeld(file: string): Promise<boolean> {
  try {
    await stat(file);
    return true;
  } catch (error) {
    if ((error as NodeJS.ErrnoException | undefined)?.code === 'ENOENT') return false;
    throw new OperatorError(
      `the recorded execution journal at ${file} could not be reached: ` +
        `${error instanceof Error ? error.message : String(error)}. A reader that treated ` +
        'this as "nothing recorded" would pass over a record it holds and look exactly like a clean answer.',
      { cause: error },
    );
  }
}

/**
 * The nearest record of `suite`, judged by the mainline selected for it. A
 * checkout's own record answers before anything fetched, so the selection, a
 * git process or two, is worked out only without one.
 */
export async function selectedRecord(root: string, suite: string | undefined, declared: DeclaredSuite | undefined): Promise<string> {
  return (await selectedRecordOf(root, suite, declared)).file;
}

/** {@link selectedRecord}, and whose record it is: no origin when no layer holds one, and the file is this checkout's own to write. */
export async function selectedRecordOf(
  root: string,
  suite: string | undefined,
  declared: DeclaredSuite | undefined,
  options: { readonly beneath?: boolean } = {},
): Promise<{ readonly file: string; readonly origin?: RecordOrigin }> {
  const selection = await import('@variance-authority/sense/test-selection');
  const own = selection.testCoverageFile(root, { suite });
  const beneath = options.beneath === true && selection.mainlineHanded(root, suite);
  if (!beneath && (await recordHeld(own))) return { file: own, origin: 'own' };
  const nearest = selection.nearestRecord(root, { suite, selected: await selectedMainline(root, declared), beneath: options.beneath });
  return nearest.origin === 'own' ? { file: nearest.file } : nearest;
}
