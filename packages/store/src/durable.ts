// compass: variance-authority.retention

import { mkdir, readFile, readdir, rm, utimes, writeFile } from 'node:fs/promises';
import { dirname, join, posix } from 'node:path';
import {
  digestFileName,
  identityDigest,
  keepsSnapshot,
  occupiesPixels,
  type Digest,
  type Raster,
  type RenderIdentity,
} from '@variance-authority/core/format';
import { codeUnitOrder } from '@variance-authority/core/segment';
import { keepImage } from '@variance-authority/png';
import {
  REFUSAL,
  RasterStoreError,
  neverFails,
  type BaselineKey,
  type Described,
  type Found,
  type RasterStore,
  type Relocated,
} from '@variance-authority/raster';
import { orAbsent } from './absent.js';
import { claim, placedForIn, placedForOf, refuseOccupied, type Claims, type PlacedFor } from './claims.js';
import { anyWidthOf, held } from './held.js';
import { legacyHolders, partitionsOf } from './legacy.js';
import { refuseAPointerRecord } from './lfs-pointer.js';
import { familyOf, identities, nearness } from './line.js';
import { KEPT, KEPT_AS, imageOf, readRaster, readSidecar, retire, type ImageReader, type Places, type Read } from './pair.js';
import { DEFAULT_BASELINE_PATH, parseBaselinePath, sanitized } from './path-template.js';

/**
 * Re-exported so a config parser can refuse a template at load time, before a
 * store exists, with the same sentence the store would throw.
 */
export { DEFAULT_BASELINE_PATH, parseBaselinePath, type BaselinePathTemplate } from './path-template.js';
export { isKeptImage, KEPT, type ImageReader, type KeptAs } from './pair.js';

/**
 * Re-exported because `{engine}` is spelled with it: a reader that matches a
 * file to the template — doctor's count of placed baselines — asks the store
 * which family an engine is rather than slicing the string a second way.
 */
export { familyOf } from './line.js';

/**
 * Re-exported because the bound on the render cache is only meaningful to
 * whoever passed {@link DurableStoreOptions.cacheRoot}, and that is this
 * entrypoint's caller.
 */
export {
  renderCacheIn,
  sweepRenderCache,
  type RenderCacheBound,
  type RenderCacheSwept,
} from './retention.js';

/**
 * Baselines on disk, one pair per subject and engine at a path a person reads.
 *
 * The path is rendered from `baselines.path`, a template over what the subject
 * *is* — the file that declares it, its title, its name — and the declared
 * engine. What painted the image is in the `.json` record beside it, and a
 * lookup compares that record with this machine's identity: a baseline another
 * machine accepted is read, reported as not comparable, and rendered against,
 * which turns a wrong-machine run into one sentence (ADR-0090). A renderer
 * upgrade therefore modifies files in place rather than renaming every one.
 *
 * What this file needs that the contract does not is a **filesystem**.
 * Everything about what a baseline *means* is in `@variance-authority/raster`
 * and shared with every other backend.
 */

export interface DurableStoreOptions {
  /**
   * Where each baseline goes under the root: a template of `{dir}`, `{file}`,
   * `{title}`, `{name}`, `{id}`, `{project}` and `{engine}`, without an extension.
   * {@link DEFAULT_BASELINE_PATH} when unset. See `path-template.ts`.
   */
  readonly path?: string;

  /**
   * Where the `.json` records go, if not beside the images, at the same
   * relative path.
   *
   * A baseline is an image and a record of how it was painted, and only the
   * image is the thing being reviewed. The record changes whenever the document
   * changes — a class name, a build id, a font that resolved differently — so a
   * record committed beside its image turns *every* edit into a diff under
   * version control, including the edits that moved no pixel. Pointed at an
   * ignored directory, a CI cache or a database export, the tracked root holds
   * images and nothing else.
   *
   * **Both halves are still written and still read.** A store that finds one
   * half of a baseline without the other still refuses, because a record that
   * went missing is a baseline that can no longer say which machine painted it.
   *
   * Unlike {@link cacheRoot} this is the operator's to set and not a thing the
   * CLI may infer: a lost cache entry costs a render, and a lost record costs
   * the run its `missingFonts` and its `findingMarks` — evidence a verdict is
   * allowed to turn on.
   */
  readonly recordRoot?: string;

  /**
   * Where the render cache goes, if not beside the baselines.
   *
   * The cache is keyed by document digest, so it gains an entry for every edit
   * and is worth nothing after the next one. Beside the baselines it shares
   * their fate: a root the operator commits grows without bound with images
   * nobody will look at. Left unset the cache stays under `root`; callers that
   * know the root is tracked set it to {@link renderCacheIn}.
   */
  readonly cacheRoot?: string;

  /**
   * How a baseline's image is read, when `find` needs its bytes.
   *
   * Defaults to reading the file. The LFS store passes a reader that fetches
   * the image first when the working tree holds its pointer, so the placement
   * that says where the file is stays here and nowhere else. A reader that
   * throws ENOENT means no image, and any other throw refuses the lookup, as a
   * read of the file would. The render cache and `describe` never call it.
   */
  readonly readImage?: ImageReader;

  /**
   * The runner's projects, by name, when it has them: a Playwright config's
   * `projects`. A record placed for a project outside them is a renamed
   * project's baseline, taken over rather than refused as a second claimant.
   * Unset, every record that names another project is refused.
   */
  readonly projects?: readonly string[];
}

/** A pair a lookup may read, and what reading it would mean. */
interface Candidate {
  readonly places: Places;
  /** Set when the pair is where the layout before `baselines.path` kept it. */
  readonly relocated?: Relocated;
  /** Set when the pair is another engine's file, as its name spells the engine. */
  readonly engine?: string;
  /** Set on the path this key renders to, whose record must name this key. */
  readonly own?: string;
}

export function createDurableStore(root: string, options: DurableStoreOptions = {}): RasterStore {
  const cacheRoot = options.cacheRoot ?? root;
  const recordRoot = options.recordRoot ?? root;
  const template = parseBaselinePath(options.path ?? DEFAULT_BASELINE_PATH);
  const projects = options.projects === undefined ? undefined : new Set(options.projects);
  const occupied = (record: PlacedFor | undefined, key: BaselineKey, path: string): void =>
    refuseOccupied(record, key, path, template, projects);
  const at = (path: string): Places => ({ image: join(root, path), record: join(recordRoot, path) });
  const readImage = options.readImage ?? readFile;

  // Every path this store has answered for, against the key it answered for.
  // The record beside each image is the claim no single store sees whole.
  const claims: Claims = new Map();
  const placed = (key: BaselineKey, identity: RenderIdentity): string => {
    const path = template.render(key, familyOf(identity.engine));
    claim(claims, key, path, template);
    return path;
  };

  /**
   * The old layout's pairs for this key, nearest identity first. The ones this
   * engine family's path now answers for are reported as moved; the rest are
   * another engine's, and stay where they are.
   *
   * A write retires fewer: only the pairs on this machine's own line. A pair at
   * another scale or on another platform may be the approved baseline of
   * another Playwright project, or of the other machine, and that project's
   * first run after the upgrade still reads it. Removing it on this accept
   * would lose it before any record names who it was placed for.
   */
  const legacy = async (key: BaselineKey, mine: RenderIdentity) => {
    const pairs: { path: string; near: number }[] = [];
    for (const { holder, leaf } of legacyHolders(key)) {
      for (const partition of await identities(join(recordRoot, holder))) {
        const path = posix.join(holder, partition, leaf);
        const stored = (await readSidecar(at(path)))?.identity;
        if (stored !== undefined) pairs.push({ path, near: nearness(stored, mine) });
      }
    }
    return pairs
      .sort((a, b) => a.near - b.near)
      .map((pair) => ({ path: pair.path, moves: !template.hasEngine || pair.near < 3, retires: pair.near <= 1 }));
  };

  /** Other engines' files at this key's path, when the path names the engine. */
  const otherEngines = async (key: BaselineKey, mine: RenderIdentity): Promise<readonly Candidate[]> => {
    const open = template.engines(key);
    if (open === undefined) return [];
    const directory = join(recordRoot, open.directory);
    const entries = await orAbsent(() => readdir(directory, { withFileTypes: true }), directory);
    const spelled = sanitized(familyOf(mine.engine));
    const found: Candidate[] = [];
    for (const entry of [...(entries ?? [])].sort((a, b) => codeUnitOrder(a.name, b.name))) {
      const leaf = open.rest === '';
      if (leaf ? !entry.isFile() || !entry.name.endsWith('.json') : !entry.isDirectory()) continue;
      const name = leaf ? entry.name.slice(0, -'.json'.length) : entry.name;
      const engine = open.name.exec(name)?.[1];
      if (engine === undefined || engine === spelled) continue;
      found.push({ places: at(posix.join(open.directory, name, open.rest)), engine });
    }
    return found;
  };

  /**
   * The pairs a lookup reads, in the order it reads them: this engine's path;
   * the old layout's pairs a write would move, this machine's line first; other
   * engines' files; the old layout's other engines.
   */
  async function* candidates(key: BaselineKey, mine: RenderIdentity): AsyncGenerator<Candidate> {
    const path = placed(key, mine);
    yield { places: at(path), own: path };
    const old = await legacy(key, mine);
    for (const pair of old) if (pair.moves) yield { places: at(pair.path), relocated: { from: pair.path, to: path } };
    yield* await otherEngines(key, mine);
    for (const pair of old) if (!pair.moves) yield { places: at(pair.path) };
  }

  /** Create a record nobody held, or refuse when another writer created it first. */
  async function create(file: string, record: string, key: BaselineKey, path: string): Promise<void> {
    try {
      await writeFile(file, record, { encoding: 'utf8', flag: 'wx' });
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') throw error;
      // Read raw: the other writer's image may not be there yet, and its
      // record may be half written, which says nobody's name yet.
      let theirs: unknown;
      try {
        const text = await readFile(file, 'utf8');
        refuseAPointerRecord(text, file);
        theirs = JSON.parse(text) as unknown;
      } catch (cause) {
        if (cause instanceof RasterStoreError) throw cause;
        throw new RasterStoreError(
          `another writer created the baseline at ${path} while this one was accepting it for ` +
            `subject ${JSON.stringify(key.subject)}. ${REFUSAL}.`,
          { cause },
        );
      }
      occupied(placedForIn(theirs), key, path);
    }
  }

  async function lookup<T extends { readonly identity: RenderIdentity }>(
    key: BaselineKey,
    mine: RenderIdentity,
    read: (places: Places) => Promise<Read<T> | null>,
  ): Promise<{ stored: T; comparable: boolean; relocated?: Relocated } | null> {
    for await (const candidate of candidates(key, mine)) {
      const found = await read(candidate.places);
      if (found === null) continue;
      const { placedFor, ...rest } = found;
      const stored = rest as unknown as T;
      // Only this key's own path. The old layout's pairs are filed by the
      // subject id, and another engine's file is told apart by its engine below.
      if (candidate.own !== undefined) occupied(placedFor, key, candidate.own);
      // `Primary-dark-chromium` fits `Primary-*` too; the record says whose it is.
      if (candidate.engine !== undefined && sanitized(familyOf(stored.identity.engine)) !== candidate.engine) continue;
      return {
        stored,
        comparable: identityDigest(stored.identity) === identityDigest(mine),
        ...(candidate.relocated === undefined ? {} : { relocated: candidate.relocated }),
      };
    }
    return null;
  }

  return {
    retention: 'durable',

    async find(key, identity): Promise<Found | null> {
      const hit = await lookup(key, identity, (places) => readRaster(places, readImage));
      if (hit === null) return null;
      const { stored, ...rest } = hit;
      return { raster: stored, storedUnder: stored.identity, ...rest };
    },

    async describe(key, identity): Promise<Described | null> {
      // The same search as `find`, reading the sidecar and only stat-ing the
      // image: "in terms of `find`" is precisely the megabyte this exists to
      // not spend.
      const hit = await lookup(key, identity, readSidecar);
      if (hit === null) return null;
      const { stored: sidecar, ...rest } = hit;
      return {
        documentDigest: sidecar.documentDigest,
        ...rest,
        storedUnder: sidecar.identity,
        pictured: occupiesPixels(sidecar),
        // Whether it kept one this code reads, never the tree: the packed
        // snapshot is the largest thing a sidecar holds, and nothing that
        // settles reads it.
        keepsSnapshot: keepsSnapshot(sidecar.snapshot),
        missingFonts: sidecar.missingFonts,
        ...(sidecar.accessibility === undefined ? {} : { accessibility: sidecar.accessibility }),
        // Names only: a describe that handed on the hashes would invite a
        // caller to settle from them, which is the document digest's job.
        ...(sidecar.components === undefined ? {} : { components: sidecar.components.map((hash) => hash.component) }),
        ...(sidecar.findingMarks === undefined ? {} : { findingMarks: sidecar.findingMarks }),
      };
    },

    async put(key, raster): Promise<void> {
      const path = placed(key, raster.identity);
      const places = at(path);
      // Before anything is written: a refused accept leaves the tree as it was.
      // A damaged pair is there, not absent: the accept repairs it, so it is
      // overwritten rather than raced for, and whoever its record still names
      // keeps the path.
      const before = await readSidecar(places).catch(async () => ({ placedFor: placedForIn(await rawRecord(places)) }));
      occupied(before?.placedFor, key, path);
      // Encoded here, on the accept, and nowhere a comparison runs: a run that
      // changes nothing never calls this. Before the first write too, so an
      // image no WebP can hold is refused with the tree as it was.
      const kept = raster.bytes === undefined ? undefined : await keepImage(Buffer.from(raster.bytes, 'base64'));
      await mkdir(dirname(places.record), { recursive: true });
      const record = `${JSON.stringify(
        { ...raster, bytes: undefined, ...(kept === undefined ? {} : { image: KEPT_AS }), placedFor: placedForOf(key) },
        null,
        2,
      )}\n`;
      // A path nobody held is taken by creating its record, so of two workers
      // that both read nothing there, the second is refused by name rather than
      // overwriting the first.
      if (before === null) await create(`${places.record}.json`, record, key, path);
      // No image for a subject that has none: the sidecar alone is the whole
      // baseline, and an image left from an earlier accept would contradict it.
      // And one image: a PNG an earlier accept kept goes when the WebP comes.
      if (kept !== undefined) {
        await mkdir(dirname(places.image), { recursive: true });
        await writeFile(imageOf(places, KEPT_AS), kept);
      }
      for (const as of KEPT) {
        if (kept === undefined || as !== KEPT_AS) await rm(imageOf(places, as), { force: true });
      }
      await writeFile(`${places.record}.json`, record, 'utf8');
      // Written first, then the old copy removed, so a write that dies between
      // the two leaves a baseline twice rather than nowhere. The pull request
      // shows the pair moving, which is what the upgrade did.
      for (const pair of await legacy(key, raster.identity)) if (pair.retires) await retire(at(pair.path));
    },

    expect(keys): void {
      // One engine for all, because a run has one: two keys refused here
      // collide under every engine.
      const seen: Claims = new Map();
      for (const key of keys) claim(seen, key, template.render(key, null), template);
    },

    /** The plan's complement, over paths this store alone can compute. See `held.ts`. */
    async unplanned(keys, identity, atAnyWidth = []): Promise<readonly string[]> {
      const engine = familyOf(identity.engine);
      const digest = identityDigest(identity);
      const planned = new Set<string>();
      for (const key of keys) {
        planned.add(template.render(key, engine));
        for (const { holder, leaf } of legacyHolders(key)) {
          for (const partition of partitionsOf(digest)) planned.add(posix.join(holder, partition, leaf));
        }
      }
      const widened = atAnyWidth.length === 0 ? undefined : anyWidthOf(template, engine, atAnyWidth);
      return held(recordRoot, { template, engine, digest, planned, ...(widened === undefined ? {} : { widened }) });
    },

    // A durable store is also a render cache: an unchanged document under an
    // unchanged identity has an image already. Wrapped, so an unreadable entry
    // or a full disk costs this run a render instead of ending it; the baseline
    // half above still throws for both, because one is the thing being
    // compared against and one is a copy of something we can make again.
    renderCache: neverFails({
      async get(digest, identity): Promise<Raster | null> {
        const path = cachedAt(cacheRoot, identityDigest(identity), digest);
        const raster = await readRaster({ image: path, record: path });
        if (raster !== null) await touch(path);
        return raster;
      },

      async put(raster): Promise<void> {
        const path = cachedAt(cacheRoot, identityDigest(raster.identity), raster.documentDigest);
        await mkdir(dirname(path), { recursive: true });
        if (raster.bytes !== undefined) {
          await writeFile(`${path}.png`, Buffer.from(raster.bytes, 'base64'));
        }
        await writeFile(`${path}.json`, `${JSON.stringify({ ...raster, bytes: undefined })}\n`, 'utf8');
      },
    }),
  };
}

/**
 * Mark an entry as wanted, so the sweep can tell live keys from dead ones.
 *
 * The only signal a cache entry carries about its own value. A render is
 * addressed by the digest of the document that produced it, so an entry stops
 * being reachable the moment the source moves — nothing will ever ask for that
 * key again, and from the outside it is indistinguishable from an entry that is
 * hit on every run. The difference is only visible here, at the hit, which is
 * why `sweepRenderCache` reads mtimes and this writes them.
 *
 * Both halves, and failures swallowed. A clock that did not move costs the
 * entry its place in the next sweep, which costs a render; refusing the hit
 * over it would cost the same render now, and a read-only cache directory would
 * turn every hit into a miss.
 */
async function touch(path: string): Promise<void> {
  const when = new Date();
  await Promise.all(
    [`${path}.png`, `${path}.json`].map(async (file) => {
      try {
        await utimes(file, when, when);
      } catch {
        // Absent, or not ours to stamp. Neither changes what was read.
      }
    }),
  );
}

/**
 * A render cache entry's path. No raw-digest fallback, unlike a baseline: a cache
 * entry nobody finds costs one render, and `sweepRenderCache` ages the old ones out.
 */
function cachedAt(cacheRoot: string, identity: Digest, documentDigest: Digest): string {
  return join(cacheRoot, digestFileName(identity), 'by-document', digestFileName(documentDigest));
}


/**
 * A record as JSON, or `undefined` when it is gone or does not parse — damage
 * says nobody's name. A pointer is not damage: it is a record this checkout
 * cannot read, so it is refused rather than written over.
 */
async function rawRecord(places: Places): Promise<unknown> {
  let text: string;
  try {
    text = await readFile(`${places.record}.json`, 'utf8');
  } catch {
    return undefined;
  }
  refuseAPointerRecord(text, `${places.record}.json`);
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return undefined;
  }
}
