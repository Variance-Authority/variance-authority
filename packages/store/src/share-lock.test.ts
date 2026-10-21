import { mkdir, mkdtemp, readdir, rm, rmdir, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishLine, type ShareEntry } from '@variance-authority/core/share';
import { variancePrecondition } from '@variance-authority/sense/precondition';
import { createDirectoryLineCell } from './share.js';

// Only `stat` and `mkdir` are cut, and each answers from the disk until a case
// says otherwise. A writer's look at a held lock's age is the one moment
// between its `mkdir` and its decision, so it is where a case puts what the
// holder does: let go before the look, or keep holding while the wait runs out.
// Left to scheduling, the first is a window that opens only sometimes and the
// second costs the whole wait. A refused `mkdir` is cut rather than made with
// a read-only directory: root makes a directory whatever its parent's mode, and
// CI runs the suite as root.
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  return { ...real, mkdir: vi.fn(real.mkdir), stat: vi.fn(real.stat) };
});
/** The file system's own answers, for a cut call to pass on. */
const disk = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

const MAIN = { kind: 'mainline', name: 'main' } as const;
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const entry: ShareEntry = { name: 'report-v1', commit: 'cccc', bytes: ascii('r') };
const write = { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map<string, Uint8Array>() };
const descends = async (): Promise<boolean> => false;
const image = async (): Promise<Uint8Array> => ascii('png');

let root = '';
let line = '';
let lock = '';

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'va-line-lock-'));
  line = join(root, 'mainline', 'main');
  lock = join(line, '.lock');
});

afterEach(async () => {
  vi.mocked(mkdir).mockRestore();
  vi.mocked(stat).mockRestore();
  vi.useRealTimers();
  await rm(root, { recursive: true, force: true });
});

describe('a line lock its holder lets go of', () => {
  it('is taken by the writer that found it held, when the holder lets go before the writer reads its age', async () => {
    variancePrecondition('fixture', { lock: 'released-before-look' });
    await mkdir(lock, { recursive: true });
    vi.mocked(stat).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path !== lock) return (disk.stat as (...args: unknown[]) => unknown)(path, ...rest);
      await rmdir(lock);
      throw Object.assign(new Error(`ENOENT: no such file or directory, stat '${lock}'`), { code: 'ENOENT' });
    }) as typeof stat);

    expect(await publishLine(createDirectoryLineCell(root), MAIN, [entry], { descends, image })).toMatchObject({ written: ['report-v1'] });
    expect(stat).toHaveBeenCalledWith(lock);
  });
});

describe('a line lock a writer does not get', () => {
  it('calls the write a conflict when the holder keeps the lock past the wait, and leaves the lock to its holder', async () => {
    variancePrecondition('fixture', { lock: 'held', clock: 'faked' });
    vi.useFakeTimers({ toFake: ['Date'] });
    await mkdir(lock, { recursive: true });
    vi.mocked(stat).mockImplementation((async (path: string, ...rest: unknown[]) => {
      // A second passes on each look: past the five-second wait in a few looks,
      // and a long way short of the minute that makes a lock a dead writer's.
      if (path === lock) vi.setSystemTime(Date.now() + 1_000);
      return (disk.stat as (...args: unknown[]) => unknown)(path, ...rest);
    }) as typeof stat);

    const cell = createDirectoryLineCell(root);
    expect(await cell.store(MAIN, write)).toBe('conflict');
    expect(vi.mocked(stat).mock.calls.filter(([path]) => path === lock).length, 'the writer should wait before it gives up').toBeGreaterThan(1);
    expect(vi.mocked(stat).mock.settledResults.map(({ type }) => type), 'each look should find the lock on disk').not.toContain('rejected');
    expect(await readdir(line)).toEqual(['.lock']);
    expect(await cell.load(MAIN)).toEqual({ kind: 'absent' });
  });

  it('answers a lock the file system will not make as refused, without waiting on it', async () => {
    variancePrecondition('fixture', { lock: 'unmakeable' });
    vi.mocked(mkdir).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path !== lock) return (disk.mkdir as (...args: unknown[]) => unknown)(path, ...rest);
      throw Object.assign(new Error(`EACCES: permission denied, mkdir '${lock}'`), { code: 'EACCES' });
    }) as typeof mkdir);

    expect(await createDirectoryLineCell(root).store(MAIN, write)).toMatchObject({ kind: 'refused' });
    expect(mkdir).toHaveBeenCalledWith(lock);
    expect(stat).not.toHaveBeenCalledWith(lock);
  });
});
