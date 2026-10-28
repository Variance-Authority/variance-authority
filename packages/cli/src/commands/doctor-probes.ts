import { access, open, readdir, readFile, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import {
  digestOfFileName,
  identityDigest,
  type Digest,
  type PageRegion,
  type RenderIdentity,
} from '@variance-authority/core/format';
import {
  DEFAULT_BASELINE_PATH,
  familyOf,
  parseBaselinePath,
  type BaselinePathTemplate,
} from '@variance-authority/store/durable';
import type { Renderer } from '@variance-authority/raster';
import type { BrowserEngine, Config } from '../config.js';
import { readCache, type CacheReading } from './doctor-cache.js';
import { renderCacheRoot } from './renders.js';

/**
 * What `variance doctor` asks *this* machine, separated from what it concludes.
 *
 * The findings in `./doctor` are a report about a machine; this is the machine
 * half — a browser that opens or does not, and a filesystem walked for the
 * identities a store's records name. They are one interface
 * away from each other so that the reasoning can be tested against a fake and
 * the walk can be tested against a real directory tree, which is the only way
 * either half is worth having.
 */

export interface DoctorProbes {
  /** Opens a renderer on this machine. Rejecting is a finding, not an error. */
  renderer(): Promise<Renderer>;
  /** Whether a path exists here. Used for baseline roots; never for a URL. */
  exists(path: string): Promise<boolean>;
  /**
   * The identities a baseline root's records name, and how many baselines each holds.
   *
   * Two layouts are read. A record at a path `baselines.path` renders names its
   * identity inside it, so it is opened; a directory named for an identity, the
   * layout before `baselines.path`, names it in the directory, so its images are
   * counted without opening one.
   *
   * A probe rather than a call into `@variance-authority/store` because doctor
   * must answer for a root that is empty, absent, or holds something else
   * entirely — none of which a store can open — and because the CLI does not
   * reach into a backend's layout to ask a question the backend was not asked.
   *
   * Both are found at any depth, rather than by listing the root. A template
   * with `{dir}` puts baselines beside the components, so a scan one level deep
   * answers *this root holds nothing* for a root full of baselines — and a
   * doctor that is wrong in the direction of "fine" is worse than no doctor.
   */
  partitions(root: string): Promise<readonly PartitionReading[]>;

  /**
   * Every image the store under a root would read whose first bytes are a
   * git-LFS pointer, relative to the root and sorted.
   *
   * The images are the ones `partitions` counts, at any depth: beside each
   * record `baselines.path` places, and in each identity directory. Nothing
   * else is opened, because a collocated root is the repository, and an LFS
   * file that is no baseline is not a baseline the run would refuse. The
   * signature is the store's own (`isLfsPointer`), so doctor finds exactly what
   * the run would refuse — which is none of them where git-lfs is set up in the
   * root's work tree, since there the run fetches each image it compares.
   */
  pointers(root: string): Promise<readonly string[]>;

  /**
   * This machine's render cache: where it is, and what each identity holds.
   *
   * A probe with no argument, because unlike a baseline root the operator
   * usually never chose this path — `cacheRoot` is optional, and without it the
   * cache is a default under the home directory. Reporting it is therefore how an
   * operator learns the directory exists at all, which is the condition it is
   * reported for: a cache that prunes itself and a cache nobody can find are
   * still two different problems.
   */
  renderCache(): Promise<RenderCacheReading>;

  /** The rest of the cache: what it holds, and what a prune would remove and keep. See `doctor-cache.ts`. */
  cache(): Promise<CacheReading>;
}

/** One machine's baselines under a root, summed over every directory named for it. */
export interface PartitionReading {
  readonly identity: Digest;
  readonly baselines: number;
  /**
   * How many of them sit in a directory named with the raw `v1:` digest.
   *
   * They still compare — the store reads that name as a fallback — but a colon
   * is a name NTFS refuses and `actions/upload-artifact` will not carry, so they
   * are counted to be said. Absent when there are none.
   */
  readonly colonSpelled?: number;
}

/** What a walk of the render cache found, per identity and in total. */
export interface RenderCacheReading {
  readonly root: string;
  readonly bytes: number;
  readonly entries: number;
  readonly identities: readonly { identity: string; entries: number; bytes: number }[];
}

/**
 * Everything the config says about the renderer, in one expression.
 *
 * One expression because there are two call sites — `machineProbes` below and
 * `rendererFor` in `dispatch.ts` — and they answer the same question. They had already drifted once
 * by construction: `browser` arrived as a config field and `bin` read it while
 * this did not, which makes `doctor` launch Chromium, report *a renderer opened*,
 * and hand a green answer to an operator whose run is about to fail on a WebKit
 * that is not installed. A doctor that is wrong in the direction of "fine" is
 * worse than no doctor.
 */
export function rendererOptionsFor(
  config: Config,
): { fonts: readonly string[]; browser?: BrowserEngine } & PageRegion {
  return {
    fonts: config.fonts,
    ...(config.browser === undefined ? {} : { browser: config.browser }),
    ...(config.timezoneId === undefined ? {} : { timezoneId: config.timezoneId }),
    ...(config.locale === undefined ? {} : { locale: config.locale }),
  };
}

/** The probes as they run for real: a browser, and the filesystem. */
export function machineProbes(config: Config): DoctorProbes {
  return {
    // Imported when asked, as `renderer.ts` does: every command loads this
    // module, and Playwright is most of what starting one would cost.
    renderer: async () => {
      const { createPlaywrightRenderer } = await import('@variance-authority/playwright/renderer');
      return createPlaywrightRenderer(rendererOptionsFor(config));
    },
    exists: async (path) => {
      try {
        await access(path);
        return true;
      } catch {
        return false;
      }
    },
    pointers: async (root) => {
      const { isLfsPointer, LFS_POINTER_HEAD_BYTES, lfsSetup, runCommand } = await import(
        '@variance-authority/store/lfs'
      );
      const found: string[] = [];
      for (const file of await storedImages(root, placedBy(config)?.template)) {
        const head = await headOf(join(root, file), LFS_POINTER_HEAD_BYTES);
        if (head !== undefined && isLfsPointer(head)) found.push(file);
      }
      if (found.length === 0) return [];
      // A pointer the run can fetch is not one it refuses: in a work tree where
      // git runs git-lfs, the store pulls the image of each subject it compares
      // (ADR-0092). Asked only once a pointer is found, so a store of images
      // costs no git call.
      const tree = await runCommand('git', ['rev-parse', '--is-inside-work-tree'], { cwd: root }).catch(() => undefined);
      if (tree?.code === 0 && (await lfsSetup(root, runCommand)).length === 0) return [];
      return found.sort();
    },
    renderCache: async () => readRenderCache(renderCacheRoot(config)),
    cache: async () => readCache(config),
    partitions: async (root) => {
      const found = new Map<Digest, { baselines: number; colonSpelled: number }>();
      // A root that cannot be listed is reported by `exists` in the same finding.
      // Two ways to say "there is nothing here" would let the two disagree, and
      // the one with the better sentence should win.
      await collect(root, found);
      const placed = placedBy(config);
      if (placed !== undefined) await collectPlaced(placed.records ?? root, placed.template, found);
      return [...found]
        .map(([identity, { baselines, colonSpelled }]) => ({
          identity,
          baselines,
          ...(colonSpelled === 0 ? {} : { colonSpelled }),
        }))
        .sort((left, right) => right.baselines - left.baselines);
    },
  };
}

/**
 * Walk the render cache, without opening a store.
 *
 * `stat` per file rather than a size the store could report, for the reason the
 * baseline scan reads a directory too: what an operator wants to know is what is
 * *on the disk*, and a number a store computed from its own bookkeeping would
 * agree with the disk right up until the interesting case.
 *
 * Bytes are the image and its record together, because an entry is the pair —
 * that is the unit the sweep evicts and so the unit a size should be quoted in.
 */
async function readRenderCache(root: string): Promise<RenderCacheReading> {
  const identities: { identity: string; entries: number; bytes: number }[] = [];

  for (const name of await orNone(root)) {
    const identity = digestOfFileName(name);
    if (identity === undefined) continue;
    const directory = join(root, name, 'by-document');
    let entries = 0;
    let bytes = 0;

    for (const file of await orNone(directory)) {
      try {
        const found = await stat(join(directory, file));
        if (!found.isFile()) continue;
        bytes += found.size;
        // Counted on the record, which every entry has: a subject with no pixels
        // is cached as a `.json` alone, and counting images would report a cache
        // holding fewer entries than it will answer hits for.
        if (file.endsWith('.json')) entries += 1;
      } catch {
        // Deleted under the walk by a concurrent run's sweep. It is not in the
        // cache any more, which is what a number omitting it says.
      }
    }

    if (entries > 0 || bytes > 0) identities.push({ identity, entries, bytes });
  }

  identities.sort((left, right) => right.bytes - left.bytes);
  return {
    root,
    bytes: identities.reduce((total, held) => total + held.bytes, 0),
    entries: identities.reduce((total, held) => total + held.entries, 0),
    identities,
  };
}

/**
 * Every identity directory at or under `directory`, summed by identity: where a
 * baseline was kept when the path carried the renderer identity.
 *
 * Summed rather than listed per location, because one machine's partition is one
 * partition however many component directories it is spread across — a root
 * with forty components has forty directories named for the same digest,
 * and reporting forty machines would be the opposite of the sentence this probe
 * exists to produce. For the same reason both spellings of a digest are one
 * identity: `digestOfFileName` reads either, and a directory that spells no
 * digest is descended into rather than counted, so `by-document` is never a
 * machine.
 */
async function collect(
  directory: string,
  found: Map<Digest, { baselines: number; colonSpelled: number }>,
): Promise<void> {
  for (const entry of await direntsOf(directory)) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    const identity = digestOfFileName(entry.name);
    if (identity !== undefined) {
      const images = (await orNone(path)).filter((name) => name.endsWith('.png')).length;
      const sum = found.get(identity) ?? { baselines: 0, colonSpelled: 0 };
      sum.baselines += images;
      if (entry.name === identity) sum.colonSpelled += images;
      found.set(identity, sum);
      continue;
    }
    await collect(path, found);
  }
}

/** The template a file-backed store places by, and where its records go; nothing for any other store. */
function placedBy(config: Config): { template: BaselinePathTemplate; records?: string } | undefined {
  const store = config.baselines;
  if (store === undefined || store.kind === 'remote') return undefined;
  return {
    template: parseBaselinePath(store.path ?? DEFAULT_BASELINE_PATH),
    ...(store.kind === 'directory' && store.records !== undefined ? { records: store.records } : {}),
  };
}

/**
 * Every record at a path the template renders for the engine it names, summed
 * by the identity it names.
 *
 * Opened, because the path names the engine family and nothing finer: two
 * machines that both paint Chromium write the same path, and only the record
 * says which of them did.
 */
async function collectPlaced(
  directory: string,
  template: BaselinePathTemplate,
  found: Map<Digest, { baselines: number; colonSpelled: number }>,
): Promise<void> {
  for (const { identity } of await placedRecords(directory, '', template)) {
    const digest = identityDigest(identity);
    const sum = found.get(digest) ?? { baselines: 0, colonSpelled: 0 };
    sum.baselines += 1;
    found.set(digest, sum);
  }
}

/**
 * Every record under `directory` at a path the template renders for the engine
 * it names, with that path relative to `directory` and without `.json`. Not
 * descended into: an identity directory, which {@link collect} counts;
 * `node_modules`; a directory starting with `.`; and `by-document`, the render
 * cache.
 */
async function placedRecords(
  directory: string,
  under: string,
  template: BaselinePathTemplate,
): Promise<readonly { path: string; identity: RenderIdentity }[]> {
  const records: { path: string; identity: RenderIdentity }[] = [];
  for (const entry of await direntsOf(directory)) {
    const path = under === '' ? entry.name : `${under}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'by-document' || entry.name.startsWith('.')) continue;
      if (digestOfFileName(entry.name) !== undefined) continue;
      records.push(...(await placedRecords(join(directory, entry.name), path, template)));
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith('.json')) continue;
    const identity = await recordedIdentity(join(directory, entry.name));
    if (identity === undefined) continue;
    const placed = path.slice(0, -'.json'.length);
    if (!template.matches(placed, familyOf(identity.engine))) continue;
    records.push({ path: placed, identity });
  }
  return records;
}

/**
 * The images a store under `root` would read, relative to it: the one beside
 * each record the template places, and every image in an identity directory,
 * the layout before `baselines.path`. Only those, so that a collocated root of
 * `.` is not a walk of the repository, and an LFS file that is no baseline is
 * never named as one.
 */
async function storedImages(root: string, template: BaselinePathTemplate | undefined): Promise<readonly string[]> {
  const images = new Set<string>();
  if (template !== undefined) {
    for (const { path } of await placedRecords(root, '', template)) images.add(`${path}.png`);
  }
  const identityDirectories = async (directory: string, under: string): Promise<void> => {
    for (const entry of await direntsOf(directory)) {
      if (!entry.isDirectory()) continue;
      if (entry.name === 'node_modules' || entry.name.startsWith('.')) continue;
      const path = under === '' ? entry.name : `${under}/${entry.name}`;
      if (digestOfFileName(entry.name) === undefined) {
        await identityDirectories(join(directory, entry.name), path);
        continue;
      }
      for (const name of await orNone(join(directory, entry.name))) {
        if (name.endsWith('.png')) images.add(`${path}/${name}`);
      }
    }
  };
  await identityDirectories(root, '');
  return [...images];
}

/** What `directory` holds, or nothing when it cannot be read: a probe reports, it never stops. */
async function direntsOf(directory: string): Promise<Dirent[]> {
  try {
    return await readdir(directory, { withFileTypes: true });
  } catch {
    return [];
  }
}

/** The identity a record names, or nothing for a file that is not a baseline record. */
async function recordedIdentity(path: string): Promise<RenderIdentity | undefined> {
  try {
    const record = JSON.parse(await readFile(path, 'utf8')) as { identity?: Partial<RenderIdentity> };
    return typeof record.identity?.engine === 'string' ? (record.identity as RenderIdentity) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * A file's first `length` bytes, or `undefined` when they cannot be read — gone
 * under the walk, or closed to this user. Either way it is not a pointer the run
 * would refuse, and one such file must not cost the answer for the rest.
 */
async function headOf(path: string, length: number): Promise<Uint8Array | undefined> {
  let file;
  try {
    file = await open(path, 'r');
  } catch {
    return undefined;
  }
  try {
    const { buffer, bytesRead } = await file.read(Buffer.alloc(length), 0, length, 0);
    return buffer.subarray(0, bytesRead);
  } catch {
    return undefined;
  } finally {
    await file.close().catch(() => undefined);
  }
}

async function orNone(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}
