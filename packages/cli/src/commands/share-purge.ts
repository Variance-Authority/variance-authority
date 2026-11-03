// compass: variance-authority.reach
/**
 * `variance share --purge-older-than <days>`: the records kept by commit
 * removed on request. Nothing else removes them, so a share that never asks
 * keeps them all, or leaves them to whatever expires its refs.
 */

import { purgeKept } from '@variance-authority/core/share';
import type { Config } from '../config.js';
import { loadConfig } from '../config-load.js';
import { EXIT_CLEAN, EXIT_OPERATOR, OperatorError, type ExitCode } from '../exit.js';
import { lineCellOf, mainlinesOf } from '../share-lines.js';
import { rootShare } from './mainline-base.js';
import { describeMiss, type Here } from './share.js';

const DAY_MS = 24 * 60 * 60 * 1000;

/** What the purge did on each mainline, and the code it exits with. */
export async function purgeLines(
  config: Pick<Config, 'share' | 'cacheRoot'>,
  days: number,
  mainline: string | undefined,
  here: Here & { readonly now?: number } = {},
): Promise<{ readonly lines: readonly string[]; readonly exit: ExitCode }> {
  const cwd = here.cwd ?? process.cwd();
  const cell = await lineCellOf(config, { cwd });
  if (cell === undefined) throw new OperatorError('`share --purge-older-than` needs a share, and none is configured');
  if ('kind' in cell) return { lines: [`nothing removed: ${describeMiss(cell)}.`], exit: EXIT_OPERATOR };
  const mainlines = mainline === undefined ? await mainlinesOf(config, here.env, cwd) : { names: [mainline] };
  if (!('names' in mainlines)) throw new OperatorError(`\`share --purge-older-than\` needs a mainline: nothing answered from ${mainlines.missing.join(', ')}`);
  const before = (here.now ?? Date.now()) - days * DAY_MS;
  const lines: string[] = [];
  let exit: ExitCode = EXIT_CLEAN;
  for (const name of mainlines.names) {
    const purged = await purgeKept(cell, { kind: 'mainline', name }, before);
    if (Array.isArray(purged)) {
      const count = purged.length === 0 ? 'nothing' : `${String(purged.length)} record(s)`;
      lines.push(`mainline ${name}: removed ${count} kept by commit older than ${String(days)} day(s).`);
      continue;
    }
    exit = EXIT_OPERATOR;
    lines.push(`mainline ${name}: nothing removed: ${purged === 'conflict' ? 'a record was written since it was listed, so run it again' : describeMiss(purged as Exclude<typeof purged, 'conflict' | readonly string[]>)}.`);
  }
  return { lines, exit };
}

/** `variance share --purge-older-than <days>`, on the root config's share, else the project config's. */
export async function runSharePurge(
  options: { readonly config: string; readonly purgeOlderThan: number; readonly mainline?: string },
  streams: { readonly out: (text: string) => void },
): Promise<ExitCode> {
  const selection = await import('@variance-authority/sense/test-selection');
  const root = process.cwd();
  const share = rootShare(selection.rootConfig(root));
  const place = share === undefined ? await loadConfig(options.config) : { share, cacheRoot: selection.cacheRootFor(root) };
  const done = await purgeLines(place, options.purgeOlderThan, options.mainline);
  streams.out(`${done.lines.join('\n')}\n`);
  return done.exit;
}
