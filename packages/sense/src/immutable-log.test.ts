import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { native } from './addon.js';
import { BadLogPath, openImmutableLog } from './immutable-log.js';
import { decodeSourceIndex, encodeSourceIndex } from './source-index-format.js';

/**
 * Segments written as the addon writes them. With nothing read, a save's layers
 * are the base, so these bytes are never parsed as an index.
 */
function publish(file: string, ...segments: string[]): void {
  expect(native()!.appendSourceIndex(file, [], false, segments.map((text) => Buffer.from(text)))).toBeNull();
}

/** A segment that is an index, with nothing in it but its configuration: a save over a chain reads its base. */
function index(config: string): Buffer {
  return encodeSourceIndex({ config, parses: new Map(), records: new Map(), directories: new Map() });
}

describe('the immutable segment log', () => {
  const made: string[] = [];

  afterAll(async () => {
    for (const directory of made) await rm(directory, { recursive: true, force: true });
  });

  async function path(): Promise<string> {
    const directory = await mkdtemp(join(tmpdir(), 'variance-immutable-log-'));
    made.push(directory);
    return join(directory, 'nested', 'index.bin');
  }

  it('returns committed segments in publication order', async () => {
    const file = await path();
    publish(file, 'one', 'two');

    expect((await openImmutableLog(file)).segments.map(String)).toEqual(['one', 'two']);
  });

  it('keeps the chain up to the first segment that fails its digest', async () => {
    const file = await path();
    expect(native()!.appendSourceIndex(file, [], false, ['one', 'two', 'three'].map(index))).toBeNull();
    const [, second] = (await openImmutableLog(file)).digests;
    await writeFile(join(`${file}.segments`, `${second!.replace(':', '-')}.bin`), 'changed');

    const opened = await openImmutableLog(file);
    expect(opened.segments.map((segment) => decodeSourceIndex(segment).config)).toEqual(['one']);
    expect(opened.dropped).toBe(2);

    // A save over the prefix it read replaces what the manifest named past it.
    expect(native()!.appendSourceIndex(file, [...opened.digests], false, [index('four')])).toBeNull();
    const next = await openImmutableLog(file);
    expect(next.segments.map((segment) => decodeSourceIndex(segment).config)).toEqual(['one', 'four']);
    expect(next.dropped).toBe(0);
  });

  it('treats a missing segment as the end of the chain', async () => {
    const file = await path();
    publish(file, 'one', 'two');
    const [, second] = (await openImmutableLog(file)).digests;
    await rm(join(`${file}.segments`, `${second!.replace(':', '-')}.bin`));

    const opened = await openImmutableLog(file);
    expect(opened.segments.map(String)).toEqual(['one']);
    expect(opened.dropped).toBe(1);
  });

  it('refuses a path that cannot name a file before it writes anything', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-immutable-log-'));
    made.push(directory);
    const notAPath = { file: join(directory, 'index.bin') } as unknown as string;

    await expect(openImmutableLog(notAPath)).rejects.toBeInstanceOf(BadLogPath);
    expect(await readdir(directory)).toEqual([]);
  });
});
