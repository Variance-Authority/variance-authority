// compass: variance-authority.retention

import { sweepRenderCache, type RenderCacheSwept } from '@variance-authority/store/durable';
import type { Config } from '../config.js';
import { renderCacheRoot } from './resources.js';

export type { RenderCacheSwept };

/**
 * Apply the bound to this machine's render cache, and say what it took.
 *
 * Called at the end of a run rather than offered as a command, because the
 * failure this answers is that nobody knows the directory exists. A `variance
 * prune` would be documentation of a path, and an operator who has read the
 * documentation was never the one whose disk filled up.
 *
 * **Unconditional, and the config is deliberately not read.** Only a `directory`
 * or `lfs` store writes here — an `ephemeral` run keeps its renders in a `Map`
 * and a `remote` one leaves them at the far end — so the obvious gate is to
 * sweep only on the two modes that fill the directory. That gate is backwards.
 * The arrangement this project is built for is CI against a tribunal, which
 * writes nothing here, and the machine carrying the 348 MB that put this file in
 * the tree had already moved to it: the cache was left behind by the local runs
 * that came before. A sweep conditioned on the cache still being in use would
 * have kept every one of those bytes forever, and a bound that lapses the moment
 * a directory stops being useful is not a bound. In those modes nothing
 * refreshes an entry, so the age rule takes the whole cache over a fortnight and
 * then takes the directory.
 *
 * The cost on a run with no cache is one failed `readdir`.
 */
export async function sweepRenders(config: Config): Promise<RenderCacheSwept> {
  // Named for the signature every other command in this directory takes, and
  // unused on purpose: see above. A parameter removed here is a parameter the
  // next reader adds back as a gate.
  void config;
  return await sweepRenderCache(renderCacheRoot());
}

/**
 * One line naming the cache, what it holds, and what this run took back.
 *
 * Printed whenever there is something in the directory rather than only on the
 * runs that deleted something, because the size is the half nobody can otherwise
 * see: the cache is outside the work tree and under a dot-directory, so an
 * operator who has never been told this path exists has no way to arrive at it.
 * A line that appeared only when the sweep bit would keep that true for every
 * machine the bound never binds on — which is most of them, right up until one
 * of them is not.
 *
 * An empty cache with nothing taken prints nothing. That is the CI run: it
 * renders against a tribunal and has no local cache to report, and a `0.0 MiB`
 * line on every job is a path that means nothing to the one reader who could
 * not act on it anyway.
 */
export function renderCacheLine(swept: RenderCacheSwept): string {
  if (swept.held === 0 && swept.removed === 0) return '';
  const freed = swept.removed === 0 ? '' : `, freed ${mib(swept.freed)}`;
  return `renders: ${mib(swept.held)} cached in ${swept.root}${freed}\n`;
}

function mib(bytes: number): string {
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
