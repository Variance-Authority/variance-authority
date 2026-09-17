// compass: variance-authority.retention

import { identityDigest, type Raster } from '@variance-authority/core/format';
import { neverFails, type Described, type Found, type RasterStore } from './store.js';

/**
 * The mode that keeps nothing, and what "nothing" has to mean while a run is
 * still going.
 *
 * Both images are produced now, by one renderer, and thrown away. The machine
 * cancels out by construction, so the comparison needs no container, no pinned
 * runner and no stored artifact — and this is the arrangement the project is
 * built for: a CI job against a tribunal, on a box that keeps nothing between
 * jobs and would not be helped if it did.
 *
 * The one thing it does keep is a render cache, so that a subject read a second
 * time inside the run is not painted a second time. Its bound is this file's
 * subject, and the reasoning is in {@link createEphemeralStore}.
 */

/**
 * How much painted image an ephemeral run keeps resident. 64 MiB.
 *
 * Sized against what a hit is actually for rather than against a machine. The
 * only reader of this cache is the same subject asked a second time inside the
 * same run — `again` re-collects it and `alone` re-renders it clean, both inline
 * and immediately — so the working set that has to survive is one subject deep,
 * and everything above that is a bet that two subjects in the suite render
 * byte-identical documents. 64 MiB is around fifteen hundred page-sized images:
 * generous against the bet, and a ceiling rather than a suite.
 */
const DEFAULT_HELD_BYTES = 64 * 1024 * 1024;

/** What an ephemeral store is allowed to keep while a run is in flight. */
export interface EphemeralStoreOptions {
  /** Resident image bytes before the least recently used are dropped. Default 64 MiB. */
  readonly heldBytes?: number;
}

/**
 * In-memory, discarded when the process ends.
 *
 * `find` never returns anything: an ephemeral run has no past. Both images are
 * rendered in the same run and the caller compares them directly, which is why
 * this mode has nothing to say about comparability — there is only one machine
 * in the story.
 *
 * **The render cache here is bounded, and that is not an optimisation.** This is
 * the mode a CI job runs in, and its claim is that it needs no container, no
 * pinned runner and no stored artifact. An unbounded `Map` keeps every image the
 * run ever painted, base64, for as long as the process lives — a wide suite then
 * holds its entire output resident in order to serve a lookup that nothing
 * outside the current subject ever makes, and the mode advertised as storing
 * nothing turns out to store all of it somewhere nobody thought to look. It is
 * discarded at exit either way; "at exit" is not timely on a suite whose run is
 * the thing that has to fit.
 *
 * Least recently used goes first, because the one reader is the subject being
 * asked again and it is always the most recent. What eviction costs is a render,
 * which is what every miss in this interface costs.
 */
export function createEphemeralStore(options: EphemeralStoreOptions = {}): RasterStore {
  const heldBytes = options.heldBytes ?? DEFAULT_HELD_BYTES;
  const cache = new Map<string, Raster>();
  let held = 0;

  const drop = (key: string): void => {
    const held_ = cache.get(key);
    if (held_ === undefined) return;
    cache.delete(key);
    held -= weigh(held_);
  };

  return {
    retention: 'ephemeral',
    async find(): Promise<Found | null> {
      return null;
    },
    async describe(): Promise<Described | null> {
      // Nothing to be cheap about. Answering `null` here is the same statement
      // `find` makes and is made for the same reason: this mode has no past.
      return null;
    },
    async put(): Promise<void> {
      // Nothing is kept. Making this a silent no-op rather than a throw lets one
      // pipeline serve both modes, which is the point of the shared interface.
    },
    // Wrapped even though a `Map` cannot fail, so that the rule is visible at
    // every construction site rather than at the ones that happen to need it.
    renderCache: neverFails({
      async get(digest, identity): Promise<Raster | null> {
        const key = `${digest}/${identityDigest(identity)}`;
        const found = cache.get(key);
        if (found === undefined) return null;
        // Re-inserted so the map's own iteration order is recency order, which
        // is what makes the eviction below least-recently-used rather than
        // first-painted. A run that asks for one subject repeatedly would
        // otherwise evict the entry it is about to ask for again.
        cache.delete(key);
        cache.set(key, found);
        return found;
      },
      async put(raster): Promise<void> {
        const key = `${raster.documentDigest}/${identityDigest(raster.identity)}`;
        drop(key);
        cache.set(key, raster);
        held += weigh(raster);

        // `size > 1` so the entry just written is never the one evicted: an
        // image larger than the whole ceiling is a subject this run is working
        // on right now, and dropping it would mean the cache refused the only
        // entry anything was going to ask for.
        for (const oldest of cache.keys()) {
          if (held <= heldBytes || cache.size <= 1) break;
          drop(oldest);
        }
      },
    }),
  };
}

/**
 * What one cached render costs to keep, near enough to budget with.
 *
 * The image is base64 in a JS string, so its length is the cost within a few
 * per cent and the record beside it is noise against a page-sized PNG. Exact
 * accounting would mean measuring a value V8 is free to represent how it likes,
 * for a ceiling whose only consequence is how often something re-renders.
 */
function weigh(raster: Raster): number {
  return raster.bytes?.length ?? 0;
}

