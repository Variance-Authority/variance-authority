import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { native } from './addon.js';
import { openImmutableLog } from './immutable-log.js';

/** The manifests a read of `path` is handed in turn: a writer moving it between every read. */
const writers = vi.hoisted(() => ({ path: '', manifests: [] as Buffer[], reads: 0 }));

vi.mock('node:fs/promises', async (original) => {
  const actual = await original<typeof import('node:fs/promises')>();
  const readFile = (async (file: Parameters<typeof actual.readFile>[0], ...rest: unknown[]) =>
    file === writers.path && writers.manifests.length > 0
      ? writers.manifests[writers.reads++ % writers.manifests.length]
      : (actual.readFile as (...args: unknown[]) => Promise<Buffer>)(file, ...rest)) as typeof actual.readFile;
  return { ...actual, readFile };
});

function publish(file: string, ...segments: string[]): void {
  expect(native()!.appendSourceIndex(file, [], false, segments.map((text) => Buffer.from(text)))).toBeNull();
}

describe('a read racing writers that move the manifest', () => {
  const made: string[] = [];

  beforeEach(() => Object.assign(writers, { path: '', manifests: [], reads: 0 }));
  afterAll(async () => {
    for (const directory of made) await rm(directory, { recursive: true, force: true });
  });

  /** A chain `one, two` whose second segment is gone, and the manifest that names it. */
  async function lost(): Promise<{ file: string; manifest: Buffer }> {
    const directory = await mkdtemp(join(tmpdir(), 'variance-immutable-log-moved-'));
    made.push(directory);
    const file = join(directory, 'index.bin');
    publish(file, 'one', 'two');
    const [, second] = (await openImmutableLog(file)).digests;
    await rm(join(`${file}.segments`, `${second!.replace(':', '-')}.bin`));
    return { file, manifest: await readFile(file) };
  }

  it('keeps an older whole generation and reports no damage when the manifest moved under every read', async () => {
    const { file, manifest } = await lost();
    // Two manifests naming the same segments, different bytes: each read finds the other.
    const other = Buffer.concat([manifest.subarray(0, 12), Buffer.from(' '), manifest.subarray(12)]);
    other.writeUInt32LE(other.length - 12, 8);
    Object.assign(writers, { path: file, manifests: [manifest, other] });

    const opened = await openImmutableLog(file);
    expect(opened.segments.map(String)).toEqual(['one']);
    expect({ moved: opened.moved, dropped: opened.dropped }).toEqual({ moved: true, dropped: 1 });
  });

  it('reports damage when the manifest held still while its segment was missing', async () => {
    const { file } = await lost();

    const opened = await openImmutableLog(file);
    expect({ moved: opened.moved, dropped: opened.dropped }).toEqual({ moved: false, dropped: 1 });
  });
});
