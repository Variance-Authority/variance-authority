import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import {
  documentDigest,
  identityDigest,
  type Digest,
  type Raster,
  type RenderDocument,
  type RenderIdentity,
} from '@variance-authority/core';
import type { Renderer } from './renderer.js';

/**
 * Retention — the two modes, and the honest difference between them.
 *
 * **Durable.** The image is kept and compared against on a later run, possibly a
 * later week. That is only sound if the two images came from the same machine,
 * because rasterization is machine-bound — a different GPU, driver, font stack,
 * or scale factor paints the same markup differently. The industry answer is to
 * pin the whole pipeline in a container and pay for it everywhere. The answer
 * here is narrower: *state the machine, and refuse to compare across it.*
 *
 * **Ephemeral.** Both images are produced now, by one renderer, and thrown away.
 * The machine cancels out by construction — there is no second machine — so the
 * comparison needs no pinning, no container, and no stored artifact at all. This
 * is the mode that answers "we need to defer, optimize, or offload the rendering
 * in any possible way", because it removes the requirement rather than paying it.
 *
 * The interface is shared so a pipeline can be written once and run either way.
 * What differs is not the code that compares; it is where the other image comes
 * from and whether anyone is allowed to trust it later.
 */

export type Retention = 'durable' | 'ephemeral';

export interface BaselineKey {
  readonly subject: string;
  /** Distinguishes several images of one subject, e.g. a viewport or a state. */
  readonly label?: string;
}

export interface Found {
  readonly raster: Raster;
  /**
   * `true` when the stored image was produced by the identity now asking for it.
   *
   * The whole point of the durable mode. A stored baseline from another machine
   * is not a baseline — comparing against it produces a large, confident,
   * meaningless diff, and the report then blames a component for a driver.
   */
  readonly comparable: boolean;
  readonly storedUnder: RenderIdentity;
}

export interface RasterStore {
  readonly retention: Retention;

  /**
   * Look up a baseline for this key *under any identity*.
   *
   * Deliberately not scoped to the current identity. Returning nothing for a
   * baseline that exists but was written elsewhere would report "new subject",
   * and "we have never seen this" is a different and much less useful sentence
   * than "we have seen this, on a machine you are not".
   */
  find(key: BaselineKey, identity: RenderIdentity): Promise<Found | null>;

  put(key: BaselineKey, raster: Raster): Promise<void>;

  /** Rasters already produced this run, keyed by document digest. See {@link renderCached}. */
  cached(digest: Digest, identity: RenderIdentity): Promise<Raster | null>;
  cache(raster: Raster): Promise<void>;
}

/**
 * In-memory, discarded when the process ends.
 *
 * `find` never returns anything: an ephemeral run has no past. Both images are
 * rendered in the same run and the caller compares them directly, which is why
 * this mode has nothing to say about comparability — there is only one machine
 * in the story.
 */
export function createEphemeralStore(): RasterStore {
  const cache = new Map<string, Raster>();

  return {
    retention: 'ephemeral',
    async find(): Promise<Found | null> {
      return null;
    },
    async put(): Promise<void> {
      // Nothing is kept. Making this a silent no-op rather than a throw lets one
      // pipeline serve both modes, which is the point of the shared interface.
    },
    async cached(digest, identity): Promise<Raster | null> {
      return cache.get(`${digest}/${identityDigest(identity)}`) ?? null;
    },
    async cache(raster): Promise<void> {
      cache.set(`${raster.documentDigest}/${identityDigest(raster.identity)}`, raster);
    },
  };
}

/**
 * On disk, partitioned by renderer identity.
 *
 * The layout is the rule. `<root>/<identityDigest>/<subject>[.label].png` means
 * a baseline written by one machine cannot be silently picked up by another —
 * not by convention or by a check somebody remembered to write, but because it
 * is not in the directory the other machine reads. `find` then scans the sibling
 * identities so it can say what it *did* find, which is what turns a wrong-machine
 * run from a mysterious mass failure into one sentence.
 */
export function createDurableStore(root: string): RasterStore {
  return {
    retention: 'durable',

    async find(key, identity): Promise<Found | null> {
      const mine = identityDigest(identity);
      const own = await load(root, mine, key);
      if (own !== null) return { raster: own.raster, comparable: true, storedUnder: own.identity };

      for (const other of await identities(root)) {
        if (other === mine) continue;
        const found = await load(root, other, key);
        if (found !== null) {
          return { raster: found.raster, comparable: false, storedUnder: found.identity };
        }
      }
      return null;
    },

    async put(key, raster): Promise<void> {
      const path = pathFor(root, identityDigest(raster.identity), key);
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.png`, Buffer.from(raster.bytes, 'base64'));
      // The sidecar carries the identity in readable form. A directory named by a
      // digest is unreviewable, and a baseline nobody can attribute to a machine
      // is a baseline nobody can decide to discard.
      await writeFile(
        `${path}.json`,
        `${JSON.stringify({ ...raster, bytes: undefined }, null, 2)}\n`,
        'utf8',
      );
    },

    async cached(digest, identity): Promise<Raster | null> {
      // A durable store is also a render cache: an unchanged document under an
      // unchanged identity has an image already, and the cheapest render is the
      // one that does not happen.
      const path = join(root, identityDigest(identity), 'by-document', digest);
      return readRaster(path);
    },

    async cache(raster): Promise<void> {
      const path = join(
        root,
        identityDigest(raster.identity),
        'by-document',
        raster.documentDigest,
      );
      await mkdir(dirname(path), { recursive: true });
      await writeFile(`${path}.png`, Buffer.from(raster.bytes, 'base64'));
      await writeFile(
        `${path}.json`,
        `${JSON.stringify({ ...raster, bytes: undefined })}\n`,
        'utf8',
      );
    },
  };
}

/**
 * Render a document, unless an identical one has already been rendered.
 *
 * The deferral lever, in one function. Content addressing means "identical" is a
 * fact about the document rather than a guess about the branch (Principle 4), so
 * a rebase, a file move, or a rerun costs nothing, and a run over 300 subjects
 * where two changed pays for two images.
 */
export async function renderCached(
  renderer: Renderer,
  store: RasterStore,
  document: RenderDocument,
): Promise<{ raster: Raster; rendered: boolean }> {
  const hit = await store.cached(documentDigest(document), renderer.identity);
  if (hit !== null) return { raster: hit, rendered: false };

  const raster = await renderer.render(document);
  await store.cache(raster);
  return { raster, rendered: true };
}

function pathFor(root: string, identity: Digest, key: BaselineKey): string {
  const name = key.label === undefined ? key.subject : `${key.subject}__${key.label}`;
  return join(root, identity, encodeURIComponent(name));
}

async function identities(root: string): Promise<readonly string[]> {
  try {
    const entries = await readdir(root, { withFileTypes: true });
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name);
  } catch {
    return [];
  }
}

async function load(
  root: string,
  identity: string,
  key: BaselineKey,
): Promise<{ raster: Raster; identity: RenderIdentity } | null> {
  const raster = await readRaster(pathFor(root, identity, key));
  return raster === null ? null : { raster, identity: raster.identity };
}

async function readRaster(path: string): Promise<Raster | null> {
  try {
    const [meta, bytes] = await Promise.all([
      readFile(`${path}.json`, 'utf8'),
      readFile(`${path}.png`),
    ]);
    return { ...(JSON.parse(meta) as Omit<Raster, 'bytes'>), bytes: bytes.toString('base64') };
  } catch {
    return null;
  }
}
