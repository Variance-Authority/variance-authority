import type { FileHandle } from 'node:fs/promises';
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { native } from './addon.js';
import {
  carriedSourceIndex,
  fetchedSourceIndexPath,
  placeSourceIndex,
  sourceIndexChain,
  sweepFetchedSourceIndexes,
} from './source-index-copy.js';
import { encodeSourceIndex } from './source-index-format.js';

/** Every piece hashed, and a disk that takes at most `short` bytes per write once it is set. */
const seen = vi.hoisted(() => ({ hashed: [] as number[], short: undefined as number | undefined }));

vi.mock('./digest.js', async (actual) => {
  const real = await actual<typeof import('./digest.js')>();
  return {
    ...real,
    sha256Hex: (bytes: Uint8Array) => {
      seen.hashed.push(bytes.length);
      return real.sha256Hex(bytes);
    },
  };
});

vi.mock('node:fs/promises', async (actual) => {
  const real = await actual<typeof import('node:fs/promises')>();
  const open = async (...args: Parameters<typeof real.open>): Promise<FileHandle> => {
    const handle = await real.open(...args);
    return new Proxy(handle, {
      get(target, key) {
        if (key === 'write' && seen.short !== undefined) {
          const most = seen.short;
          return (buffer: Uint8Array, offset = 0, length = buffer.length - offset, position?: number) =>
            target.write(buffer, offset, Math.min(length, most), position);
        }
        const value: unknown = Reflect.get(target, key);
        return typeof value === 'function' ? (value as (...rest: unknown[]) => unknown).bind(target) : value;
      },
    });
  };
  return { ...real, open };
});

/** A chain carried in pieces, and placed back from them. */

const made: string[] = [];

beforeEach(() => {
  seen.hashed = [];
  seen.short = undefined;
});

afterAll(async () => {
  for (const directory of made) await rm(directory, { recursive: true, force: true });
});

/** A segment that is an index, with nothing in it but its configuration: a save over a chain reads its base. */
function index(config: string): Buffer {
  return encodeSourceIndex({ config, parses: new Map(), records: new Map(), directories: new Map() });
}

async function chainOf(...segments: Buffer[]): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'variance-source-index-copy-'));
  made.push(directory);
  const file = join(directory, 'index.bin');
  expect(native()!.appendSourceIndex(file, [], false, segments)).toBeNull();
  return file;
}

/** The length of each `size`-byte piece of the chain at `file`, from its segment `from` on. */
async function piecesOf(file: string, size: number, from = 0): Promise<number[]> {
  const lengths: number[] = [];
  for (const { path } of (await sourceIndexChain(file))!.segments.slice(from)) {
    const { length } = await readFile(path);
    for (let at = 0; at < length; at += size) lengths.push(Math.min(size, length - at));
  }
  return lengths;
}

/** Every segment of `file`'s chain, as the bytes on disk. */
async function segmentsOf(file: string): Promise<Buffer[]> {
  return Promise.all((await sourceIndexChain(file))!.segments.map(({ path }) => readFile(path)));
}

/** The segments of the chain `carried` places beside `file`, each piece read from it. */
async function placedFrom(file: string, carried: Awaited<ReturnType<typeof carriedSourceIndex>>): Promise<Buffer[]> {
  const into = `${file}.placed`;
  await rm(into, { force: true });
  await rm(`${into}.segments`, { recursive: true, force: true });
  expect(await placeSourceIndex(into, carried.bytes, (name) => carried.piece(name))).toBe(true);
  return segmentsOf(into);
}

describe('a carried source index', () => {
  it('hashes only the segments no carry before it hashed, and reads the others\' pieces where they are', async () => {
    const file = await chainOf(index('one'), index('two'));
    const first = await carriedSourceIndex((await sourceIndexChain(file))!, 1024);
    expect(seen.hashed).toEqual(await piecesOf(file, 1024));
    seen.hashed = [];

    const read = (await sourceIndexChain(file))!.segments.map(({ digest }) => digest);
    expect(native()!.appendSourceIndex(file, read, false, [index('three')])).toBeNull();
    const second = await carriedSourceIndex((await sourceIndexChain(file))!, 1024);

    expect(seen.hashed).toEqual(await piecesOf(file, 1024, read.length));
    expect(second.pieces.slice(0, first.pieces.length)).toEqual(first.pieces);
    expect(await placedFrom(file, second)).toEqual(await segmentsOf(file));
  });

  it('hashes every segment again when what it kept of their pieces does not read', async () => {
    const file = await chainOf(index('one'));
    await carriedSourceIndex((await sourceIndexChain(file))!, 1024);
    await writeFile(`${file}.pieces`, 'damaged');
    seen.hashed = [];

    const carried = await carriedSourceIndex((await sourceIndexChain(file))!, 1024);

    expect(seen.hashed).toEqual(await piecesOf(file, 1024));
    expect(await placedFrom(file, carried)).toEqual(await segmentsOf(file));
  });

  it('hashes every segment again when what it kept is of pieces of another size', async () => {
    const file = await chainOf(index('one'));
    await carriedSourceIndex((await sourceIndexChain(file))!, 1024);
    seen.hashed = [];

    const carried = await carriedSourceIndex((await sourceIndexChain(file))!, 512);

    expect(seen.hashed).toEqual(await piecesOf(file, 512));
    expect(await placedFrom(file, carried)).toEqual(await segmentsOf(file));
  });

  it('carries the index whole when the place it keeps piece names in cannot be read or written', async () => {
    const file = await chainOf(index('one'), index('two'));
    await mkdir(`${file}.pieces`);

    const carried = await carriedSourceIndex((await sourceIndexChain(file))!, 1024);

    expect(seen.hashed).toEqual(await piecesOf(file, 1024));
    expect(await placedFrom(file, carried)).toEqual(await segmentsOf(file));
  });

  it('places a segment whole on a disk that takes fewer bytes than it was handed', async () => {
    const file = await chainOf(index('one'), index('two'));
    const carried = await carriedSourceIndex((await sourceIndexChain(file))!, 1024);
    seen.short = 7;

    expect(await placedFrom(file, carried)).toEqual(await segmentsOf(file));
  });
});

describe('the places fetched indexes are put', () => {
  it('names another place on every call, and a sweep removes those of an ended process and no running one\'s', async () => {
    const file = await chainOf(index('one'));
    const mine = fetchedSourceIndexPath(file);
    expect(fetchedSourceIndexPath(file)).not.toBe(mine);
    // A process that has ended, as the system answers for one.
    const ended = process.pid + 1;
    const kill = process.kill.bind(process);
    vi.spyOn(process, 'kill').mockImplementation((pid, signal) => {
      if (pid === ended) throw Object.assign(new Error('kill ESRCH'), { code: 'ESRCH' });
      return kill(pid, signal);
    });
    const theirs = join(`${file}.fetched`, `${String(ended)}-left.bin`);
    for (const placed of [mine, theirs]) {
      await mkdir(`${placed}.segments`, { recursive: true });
      await writeFile(placed, 'manifest');
    }

    await sweepFetchedSourceIndexes(file);

    expect((await readdir(`${file}.fetched`)).sort()).toEqual([basename(mine), `${basename(mine)}.segments`].sort());
    vi.restoreAllMocks();
  });
});
