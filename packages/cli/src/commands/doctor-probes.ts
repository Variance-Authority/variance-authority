import { access, readdir, stat } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
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
  partitions(root: string): Promise<readonly { identity: string; baselines: number }[]>;

  /**
   * This machine's render cache: where it is, and what each identity holds.
   *
   * A probe with no argument, because unlike a baseline root the operator never
   * chose this path — `variance run` puts the cache under `XDG_CACHE_HOME` and
   * nothing in a config can move it. Reporting it is therefore the only way an
   * operator learns the directory exists at all, which is the condition it is
   * reported for: a cache that prunes itself and a cache nobody can find are
   * still two different problems.
   */
  renderCache(): Promise<RenderCacheReading>;
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
    renderCache: async () => readRenderCache(renderCacheRoot()),
    partitions: async (root) => {
      const found = new Map<string, number>();
      // A root that cannot be listed is reported by `exists` in the same finding.
      // Two ways to say "there is nothing here" would let the two disagree, and
      // the one with the better sentence should win.
      await collect(root, found);
      return [...found]
        .map(([identity, baselines]) => ({ identity, baselines }))
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
    if (!IDENTITY_DIRECTORY.test(name)) continue;
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

    if (entries > 0 || bytes > 0) identities.push({ identity: name, entries, bytes });
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
 * exists to produce.
 */
async function collect(directory: string, found: Map<string, number>): Promise<void> {
  let entries: Dirent[];
  try {
    entries = await readdir(directory, { withFileTypes: true });
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const path = join(directory, entry.name);
    if (IDENTITY_DIRECTORY.test(entry.name)) {
      const images = (await orNone(path)).filter((name) => name.endsWith('.png')).length;
      found.set(entry.name, (found.get(entry.name) ?? 0) + images);
      continue;
    }
    await collect(path, found);
  }
}

/**
 * What an identity directory is named, and the reason the walk can recurse at all.
 *
 * `@variance-authority/store` names them for `identityDigest`, which is a `v1:`
 * digest and nothing else is. Without the shape this walk would have to descend
 * into a partition and count `by-document` as a machine.
 */
const IDENTITY_DIRECTORY = /^v1:[0-9a-f]{32}$/;

async function orNone(directory: string): Promise<readonly string[]> {
  try {
    return await readdir(directory);
  } catch {
    return [];
  }
}
