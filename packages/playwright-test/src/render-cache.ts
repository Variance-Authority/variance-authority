// compass: variance-authority.retention

import type { RasterStore } from '@variance-authority/raster';
import { cacheRootFor } from '@variance-authority/sense/cache-root';
import {
  createDurableStore,
  renderCacheIn,
  sweepRenderCache,
} from '@variance-authority/store/durable';

/** Render caches this process has already bounded. */
const swept = new Map<string, Promise<unknown>>();

/**
 * A directory store on a baseline root somebody commits, and the bound on the
 * render cache it paints into.
 *
 * The cache goes where `variance run` puts it, `renders` in the checkout's
 * cache, so it never lands in a tracked tree and one bound covers every runner
 * on the machine. The sweep runs once per process for each cache: a one-shot
 * `observe` opens and closes a session per call, and walking the cache that
 * often would cost more than the cache saves.
 */
export function checkoutStore(baselines: string): {
  readonly store: RasterStore;
  readonly sweep: () => Promise<void>;
} {
  const renders = renderCacheIn(cacheRootFor(process.cwd()));
  return {
    store: createDurableStore(baselines, { cacheRoot: renders }),
    sweep: async () => {
      if (!swept.has(renders)) swept.set(renders, sweepRenderCache(renders));
      await swept.get(renders);
    },
  };
}
