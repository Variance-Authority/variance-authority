// compass: variance-authority.retention

import {
  renderCacheIn,
  sweepRenderCache,
  type RenderCacheSwept,
} from '@variance-authority/store/durable';
import type { Config } from '../config.js';
import { cacheOf } from './resources.js';

export type { RenderCacheSwept };

/**
 * Where the render cache goes: in the cache, never beside the baselines.
 *
 * A durable store is also a render cache, keyed by document digest. Left where
 * the baselines are, the cache of an LFS store lands inside a tracked, LFS-routed
 * directory and is committed exactly like a baseline — and unlike a baseline it
 * gains an entry for every edit and is worthless the moment the next one lands.
 * The repository then grows without bound with images nobody will ever look at,
 * and the quota that was bought for baselines pays for them.
 *
 * **Why the location is allowed to fall back to the environment, when nothing
 * else is.** The config file refuses inferred values because they change what is
 * observed. This one cannot: the cache is content-addressed by document digest
 * under an identity digest, so a lookup either finds an image painted from this
 * exact document by this exact machine or finds nothing. A wrong location, a
 * stale entry, or a cache shared between projects can therefore cost a re-render
 * and can never produce a wrong image, so `cacheRootFor` may answer from
 * `VARIANCE_AUTHORITY_CACHE` when the repository names no `cacheRoot`.
 *
 * *What it costs.* A directory the baselines do not reach, which is why it
 * prunes itself rather than waiting to be found. See {@link sweepRenderCache},
 * which every run applies.
 */
export function renderCacheRoot(config: Pick<Config, 'cacheRoot'>): string {
  return renderCacheIn(cacheOf(config));
}

/**
 * Apply the bound to this machine's render cache, and say what it took.
 *
 * Called at the end of a run rather than offered as a command, because the
 * failure this answers is that nobody knows the directory exists. A `variance
 * prune` would be documentation of a path, and an operator who has read the
 * documentation was never the one whose disk filled up.
 *
 * **Unconditional: the config says where the cache is and nothing about whether to sweep it.** Only a `directory`
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
  return await sweepRenderCache(renderCacheRoot(config));
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
