import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
import { keyFor, parseWay } from './files.js';
import type { NativeGitTree } from './native.js';
import { nativeAvailable } from './addon.js';
import { nativeIndexGraph } from './native-index-graph.js';
import { parseStorePath } from './parse-store.js';
import { updateSourceIndex } from './test-support/published.js';
import { MODULE_EXTENSIONS } from './read.js';
import { shapeOf } from './reuse.js';
import { LARGEST_FILE, scanCount } from './test-support/scan.js';
import { openImmutableLog } from './immutable-log.js';
import { decodeSourceIndex } from './test-support/source-index-format.js';
import { CACHE_VARIABLE } from './test-selection/cache-layers.js';
import { gitTreeOf } from './tree.js';

/**
 * The closure the addon holds, against the one it hands over.
 *
 * The binary generation is decoded into the records a save accepts. Both save
 * paths run over this repository's own sources, with an extra record beside a
 * closure — a stylesheet's record, a parse — added to each, and the index each
 * one publishes is compared file for file, byte for byte: onto an empty chain,
 * which the addon publishes itself, and onto a committed one, where the save
 * writes a delta and the addon encodes the closure into it.
 */

const run = promisify(execFile);
const available = nativeAvailable();
const root = resolve(import.meta.dirname, '../../..');

describe('a cold closure held by the addon', () => {
  it.runIf(available)('publishes its native parse and record columns without decoded caller state', async () => {
    const seeds = await modules('packages/sense/src/');
    const tree = (await gitTreeOf(root, ['packages/sense/src']))!;
    const { shape, aliases } = await shapeOf({ root, tree });
    const graph = nativeIndexGraph(tree.native!, {
      root, seeds, largestFile: LARGEST_FILE, remembering: true, aliases, directories: shape.directories,
    });
    const directory = await mkdtemp(join(tmpdir(), 'sense-index-graph-'));
    try {
      const path = join(directory, 'source-index.bin');
      expect(graph.publish(path, [])).toBeNull();
      const published = await openImmutableLog(path);
      expect(published.segments).toEqual([Buffer.from(graph.parseSegment()), Buffer.from(graph.encode([]))]);
      const records = decodeSourceIndex(published.segments[1]!).records;
      const parses = decodeSourceIndex(published.segments[0]!).parses;
      expect(records.size).toBe(graph.size);
      expect(seeds.every((file) => records.has(file))).toBe(true);
      expect(parses.size).toBeGreaterThan(0);
      expect([...parses.keys()].every((key) => graph.hasParse(key))).toBe(true);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }, 120_000);

  // A scan of ten thousand modules or more takes this path, and `ask symbol`
  // reads its declarations from the parses it publishes: a closure that left
  // them out answered a large checkout as if it declared nothing.
  it.runIf(available)('publishes the declarations of every module it parses', async () => {
    const seeds = ['packages/sense/src/native-update.ts'];
    const tree = (await gitTreeOf(root, ['packages/sense/src']))!;
    const { shape, aliases } = await shapeOf({ root, tree });
    const held = nativeIndexGraph(tree.native!, {
      root,
      seeds,
      largestFile: LARGEST_FILE,
      remembering: true,
      aliases,
      directories: shape.directories,
    })!;
    const read = decodeSourceIndex(held.encode([])).records.get(seeds[0]!)!.record;
    const { parses } = decodeSourceIndex(held.parseSegment());
    const parsed = parses.get(keyFor(read.digest!, parseWay(read.file)));
    expect(parsed?.harvested).toBe(true);
    expect(parsed?.symbols?.map((symbol) => symbol.name)).toContain('updateNatively');
    // Every wave, not only the seeds': the closure reaches past the first file.
    expect(parses.size).toBeGreaterThan(seeds.length);
    expect([...parses.values()].filter((each) => each.harvested !== true)).toEqual([]);
  });

  // `scanCount` reports what the closure parsed: a module it declined for its
  // size holds a record but was never parsed.
  it.runIf(available)('counts the modules it parsed, not the ones it declined', async () => {
    const seeds = ['packages/sense/src/native-update.ts'];
    const tree = (await gitTreeOf(root, ['packages/sense/src']))!;
    const { shape, aliases } = await shapeOf({ root, tree });
    const closure = (largestFile: number) => nativeIndexGraph(tree.native!, {
      root, seeds, largestFile, remembering: true, aliases, directories: shape.directories,
    })!;
    const declined = closure(1);
    expect(declined.size).toBe(1);
    expect(declined.parsed).toBe(0);
    const read = closure(LARGEST_FILE);
    expect(read.parsed).toBe(decodeSourceIndex(read.parseSegment()).parses.size);
  });

  // Ten thousand modules is where a scan hands its closure to the addon to hold.
  const closureSize = 10_000;

  /** A committed checkout of `closureSize` small modules and one over the size limit. */
  async function many(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'variance-scan-count-'));
    await mkdir(join(directory, 'src'));
    for (let at = 0; at < closureSize; at += 500) {
      await Promise.all(Array.from({ length: 500 }, (_, each) =>
        writeFile(join(directory, 'src', `m${String(at + each)}.ts`), `export const m = ${String(at + each)};\n`)));
    }
    await writeFile(join(directory, 'src', 'wide.ts'), `export const wide = '${'x'.repeat(LARGEST_FILE)}';\n`);
    await run('git', ['init', '--quiet'], { cwd: directory });
    await run('git', ['add', '.'], { cwd: directory });
    await run('git', ['-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '--quiet', '-m', 'many'], { cwd: directory });
    return directory;
  }

  it.runIf(available)('counts, through a scan, every module the closure holds and only the ones it parsed', async () => {
    const counted = await scanCount({ root: await many(), dirs: ['src'] });
    expect(counted).toMatchObject({ files: closureSize + 1, parsed: closureSize });
  }, 120_000);

  it.runIf(available)('parses none of a closure it holds whose modules a store kept from another root', async () => {
    const before = process.env[CACHE_VARIABLE];
    const cache = await mkdtemp(join(tmpdir(), 'variance-scan-store-'));
    process.env[CACHE_VARIABLE] = cache;
    try {
      await updateSourceIndex(await many());
      const counted = await scanCount({ root: await many(), dirs: ['src'], stores: [parseStorePath(cache)] });
      expect(counted).toMatchObject({ files: closureSize + 1, parsed: 0 });
    } finally {
      if (before === undefined) delete process.env[CACHE_VARIABLE];
      else process.env[CACHE_VARIABLE] = before;
    }
  }, 240_000);

  it('throws a closure the addon failed to build to the scan that asked for it', () => {
    const tree = {
      indexGraph: () => {
        throw new Error('source index: "x" was never collected into the dictionary');
      },
    } as unknown as NativeGitTree;
    expect(() => nativeIndexGraph(tree, {
      root,
      seeds: ['a.ts'],
      largestFile: LARGEST_FILE,
      remembering: false,
      aliases: undefined,
      directories: new Map(),
    })).toThrow('source index: "x" was never collected into the dictionary');
  });
});

/** Every tracked module under `prefix` that is on the disk. */
async function modules(prefix: string): Promise<string[]> {
  const { stdout } = await run('git', ['ls-files', '-z', '--', prefix], { cwd: root, maxBuffer: 1 << 28 });
  return stdout
    .split('\0')
    .filter((path) => path !== '' && MODULE_EXTENSIONS.some((end) => path.endsWith(end)))
    .filter((path) => existsSync(join(root, path)));
}
