import { mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { BadLogPath, openImmutableLog } from './immutable-log.js';

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
    await (await openImmutableLog(file)).publish(Buffer.from('one'), () => Buffer.from('one'));
    await (await openImmutableLog(file)).publish(Buffer.from('two'), () => Buffer.from('one-two'));

    expect((await openImmutableLog(file)).segments.map(String)).toEqual(['one', 'two']);
  });

  it('rejects the complete chain when one named segment fails its digest', async () => {
    const file = await path();
    await (await openImmutableLog(file)).publish(Buffer.from('one'), () => Buffer.from('one'));
    const [segment] = await readdir(`${file}.segments`);
    await writeFile(join(`${file}.segments`, segment!), 'changed');

    await expect(openImmutableLog(file)).rejects.toThrow('invalid immutable log segment');
  });

  it('refuses a path that cannot name a file before it writes anything', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'variance-immutable-log-'));
    made.push(directory);
    const notAPath = { file: join(directory, 'index.bin') } as unknown as string;

    await expect(openImmutableLog(notAPath)).rejects.toBeInstanceOf(BadLogPath);
    expect(await readdir(directory)).toEqual([]);
  });

  it('compacts the ninth layer into one complete segment', async () => {
    const file = await path();
    for (let index = 1; index <= 9; index += 1) {
      const log = await openImmutableLog(file);
      await log.publish(Buffer.from(`delta-${index}`), () => Buffer.from(`complete-${index}`));
    }

    const opened = await openImmutableLog(file);
    expect(opened.segments.map(String)).toEqual(['complete-9']);
    expect(await readdir(`${file}.segments`)).toHaveLength(1);
    expect((await readFile(file)).subarray(0, 8).toString('utf8')).toBe('VAIDXLSM');
  });
});
