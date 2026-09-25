import { access, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { digestOfFileName, type Digest } from '@variance-authority/core/format';
import type { Renderer } from '@variance-authority/raster';
import type { BrowserEngine, Config } from '../config.js';
import { renderCacheRoot } from './resources.js';

/**
 * What `variance doctor` asks *this* machine, separated from what it concludes.
 *
 * The findings in `./doctor` are a report about a machine; this is the machine
 * half — a browser that opens or does not, and a filesystem walked for the
 * identity directories a store names its partitions with. They are one interface
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
   * The identity directories under a baseline root, and how many images each holds.
   *
   * A probe rather than a call into `@variance-authority/store` because doctor
   * must answer for a root that is empty, absent, or holds something else
   * entirely — none of which a store can open — and because the CLI does not
   * reach into a backend's layout to ask a question the backend was not asked.
   *
   * Identity directories are found by name at any depth, rather than by listing
   * the root. Under a `beside` layout they sit beside the components, so a scan
   * one level deep answers *this root holds nothing* for a root full of
   * baselines — and a doctor that is wrong in the direction of "fine" is worse
   * than no doctor.
   */
  partitions(root: string): Promise<readonly PartitionReading[]>;

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
export function rendererOptionsFor(config: Config): { fonts: readonly string[]; browser?: BrowserEngine } {
  return {
    fonts: config.fonts,
    ...(config.browser === undefined ? {} : { browser: config.browser }),
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
    renderCache: async () => readRenderCache(renderCacheRoot(config)),
    partitions: async (root) => {
      const found = new Map<Digest, { baselines: number; colonSpelled: number }>();
      // A root that cannot be listed is reported by `exists` in the same finding.
      // Two ways to say "there is nothing here" would let the two disagree, and
      // the one with the better sentence should win.
      await collect(root, found);
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
 * Every identity directory at or under `directory`, summed by identity.
 *
 * Summed rather than listed per location, because one machine's partition is one
 * partition however many component directories it is spread across — a `beside`
 * root with forty components has forty directories named for the same digest,
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
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
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

async function orNone(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}
