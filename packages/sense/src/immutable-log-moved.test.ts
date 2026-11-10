import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { native } from './addon.js';
import { openImmutableLog } from './immutable-log.js';
import { readPublishedNames } from './published-names.js';
import { encodeSourceIndex } from './source-index-format.js';

/** The manifests reads of `path` are handed in turn, the last one held: writers moving it, then stopping. */
const writers = vi.hoisted(() => ({ path: '', manifests: [] as Buffer[], reads: 0 }));

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const readFile = (async (file: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) =>
    file === writers.path && writers.manifests.length > 0
      ? writers.manifests[Math.min(writers.reads++, writers.manifests.length - 1)]
      : (actual.readFile as (...args: unknown[]) => Promise<Buffer>)(file, ...rest)) as typeof actual.readFile;
  return { ...actual, readFile };
});

function index(config: string): Buffer {
  return encodeSourceIndex({ config, parses: new Map(), records: new Map(), directories: new Map() });
}

/** The same manifest under other bytes: a writer that published again. */
function republished(manifest: Buffer): Buffer {
  const other = Buffer.concat([manifest.subarray(0, 12), Buffer.from(' '), manifest.subarray(12)]);
  other.writeUInt32LE(other.length - 12, 8);
  return other;
}

/** Reads that find the manifest moved every time. */
function moving(manifest: Buffer): Buffer[] {
  return Array.from({ length: 32 }, (_, at) => at % 2 === 0 ? manifest : republished(manifest));
}

describe('a read racing writers that move the manifest', () => {
  const made: string[] = [];

  beforeEach(() => Object.assign(writers, { path: '', manifests: [], reads: 0 }));
  afterAll(async () => {
    for (const directory of made) await rm(directory, { recursive: true, force: true });
  });

  /** A chain of `configs` whose segment at `gone` is missing, and the manifest that names it. */
  async function lost(gone: number, ...configs: string[]): Promise<{ file: string; manifest: Buffer }> {
    const directory = await mkdtemp(join(tmpdir(), 'variance-immutable-log-moved-'));
    made.push(directory);
    const file = join(directory, 'index.bin');
    expect(native()!.appendSourceIndex(file, [], false, configs.map(index))).toBeNull();
    const digest = (await openImmutableLog(file)).digests[gone]!;
    await rm(join(`${file}.segments`, `${digest.replace(':', '-')}.bin`));
    return { file, manifest: await readFile(file) };
  }

  function damage(log: { moved: boolean; dropped: number; damaged: number }) {
    return { moved: log.moved, dropped: log.dropped, damaged: log.damaged };
  }

  it('keeps the prefix it read and reports no damage when the manifest moved under every read', async () => {
    const { file, manifest } = await lost(1, 'one', 'two');
    Object.assign(writers, { path: file, manifests: moving(manifest) });

    const opened = await openImmutableLog(file);
    expect(opened.segments).toHaveLength(1);
    expect(damage(opened)).toEqual({ moved: true, dropped: 1, damaged: 0 });
    // What a reader cuts later is its own, not the writers'.
    expect(damage(opened.keep(0))).toEqual({ moved: true, dropped: 2, damaged: 1 });
  });

  it('reports damage when the manifest held still while its segment was missing', async () => {
    const { file } = await lost(1, 'one', 'two');

    expect(damage(await openImmutableLog(file))).toEqual({ moved: false, dropped: 1, damaged: 1 });
  });

  it('reports damage once the manifest settles with its segment still missing', async () => {
    const { file, manifest } = await lost(1, 'one', 'two');
    Object.assign(writers, { path: file, manifests: [manifest, republished(manifest)] });

    expect(damage(await openImmutableLog(file))).toEqual({ moved: false, dropped: 1, damaged: 1 });
  });

  it('reports damage when a moved read kept nothing', async () => {
    const { file, manifest } = await lost(0, 'one', 'two');
    Object.assign(writers, { path: file, manifests: moving(manifest) });

    expect(damage(await openImmutableLog(file))).toEqual({ moved: false, dropped: 2, damaged: 2 });
  });

  it('reads the names of a moved read as published', async () => {
    const { file, manifest } = await lost(1, 'one', 'two');
    Object.assign(writers, { path: file, manifests: moving(manifest) });

    expect((await readPublishedNames(file, [])).state).toBe('published');
  });
});
