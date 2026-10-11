import { existsSync, rmdirSync } from 'node:fs';
import { mkdir, mkdtemp, readdir, rm, rmdir, stat, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { publishLine, readLine, type ShareEntry } from '@variance-authority/core/share';
import { createDirectoryLineCell } from './share.js';

// Each file-system call the lock makes is cut, and answers from the disk until a
// case says otherwise: which writer reaches the lock first, and what it finds
// there, is a window scheduling opens only sometimes.
vi.mock('node:fs/promises', async (original) => {
  const real = await original<typeof import('node:fs/promises')>();
  return {
    ...real,
    mkdir: vi.fn(real.mkdir),
    rmdir: vi.fn(real.rmdir),
    stat: vi.fn(real.stat),
    utimes: vi.fn(real.utimes),
    writeFile: vi.fn(real.writeFile),
  };
});

// A writer that finds the lock held sleeps before it looks again. A case that
// sets `slept` hears each sleep before it runs.
const sleeps = vi.hoisted(() => ({ slept: undefined as (() => void) | undefined }));
vi.mock('node:timers/promises', async (original) => {
  const real = await original<typeof import('node:timers/promises')>();
  const setTimeout = (async (delay?: number, value?: unknown, options?: object) => {
    sleeps.slept?.();
    return real.setTimeout(delay, value, options);
  }) as typeof real.setTimeout;
  return { ...real, setTimeout };
});

const real = await vi.importActual<typeof import('node:fs/promises')>('node:fs/promises');

/** The age past which a lock is a dead writer's, as the directory cell counts it. */
const STALE_MS = 60_000;
const MAIN = { kind: 'mainline', name: 'main' } as const;
const ascii = (text: string): Uint8Array => Uint8Array.from(text, (char) => char.charCodeAt(0));
const entry = (suite: string): ShareEntry => ({ name: `suite-v1/${suite}`, commit: 'cccc', bytes: ascii(suite) });
const descends = async (): Promise<boolean> => false;
const image = async (): Promise<Uint8Array> => ascii('png');
const errno = (code: string, call: string, path: string): Error =>
  Object.assign(new Error(`${code}: ${call} '${path}'`), { code });

/** A promise and the function that settles it. */
function gate(): { readonly open: () => void; readonly opened: Promise<void> } {
  let open!: () => void;
  const opened = new Promise<void>((settle) => (open = settle));
  return { open, opened };
}

describe('a line lock and its holder', () => {
  let root = '';
  let lock = '';

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'va-line-holder-'));
    lock = join(root, 'mainline', 'main', '.lock');
  });

  afterEach(async () => {
    vi.useRealTimers();
    sleeps.slept = undefined;
    for (const cut of [mkdir, rmdir, stat, utimes, writeFile]) vi.mocked(cut).mockRestore();
    await rm(root, { recursive: true, force: true });
  });

  async function suites(): Promise<string[]> {
    const read = await readLine(createDirectoryLineCell(root), MAIN);
    if ('kind' in read) throw new Error(read.kind);
    return read.manifest.entries.map((held) => held.name).sort();
  }

  async function deadWritersLock(): Promise<void> {
    await real.mkdir(lock, { recursive: true });
    const old = new Date(Date.now() - 2 * STALE_MS);
    await real.utimes(lock, old, old);
  }

  it('keeps its lock fresh while it writes for longer than the stale limit, so the next writer waits for it', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const cell = createDirectoryLineCell(root);
    const reached = gate();
    const resume = gate();
    vi.mocked(writeFile).mockImplementationOnce((async (...args: Parameters<typeof writeFile>) => {
      reached.open();
      await resume.opened;
      return real.writeFile(...args);
    }) as typeof writeFile);

    const first = publishLine(cell, MAIN, [entry('a')], { descends, image });
    await reached.opened;
    // A quarter of the stale limit at a time, each step waiting for the disk to answer.
    for (let step = 0; step < 4; step += 1) {
      vi.advanceTimersByTime(STALE_MS / 4);
      await vi.waitFor(async () => {
        const age = Date.now() - (await real.stat(lock)).mtimeMs;
        expect(age, 'a lock held by a writer still writing should look fresh to the next writer').toBeLessThan(1_000);
      });
    }
    vi.advanceTimersByTime(1_000);

    const looked = vi.mocked(stat).mock.calls.length;
    const second = publishLine(cell, MAIN, [entry('b')], { descends, image });
    await vi.waitFor(() => expect(vi.mocked(stat).mock.calls.length).toBeGreaterThan(looked));
    resume.open();

    expect(await first).toMatchObject({ written: ['suite-v1/a'] });
    expect(await second).toMatchObject({ written: ['suite-v1/b'] });
    expect(await suites()).toEqual(['suite-v1/a', 'suite-v1/b']);
  });

  it('writes no manifest and leaves the new holder its lock, when its own lock was taken while it stalled', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cell = createDirectoryLineCell(root);
    vi.mocked(writeFile).mockImplementationOnce((async (...args: Parameters<typeof writeFile>) => {
      // Stalled past the stale limit, so another writer took the lock for dead and made its own.
      vi.setSystemTime(Date.now() + STALE_MS + 1_000);
      await real.rmdir(lock);
      await real.mkdir(lock);
      return real.writeFile(...args);
    }) as typeof writeFile);

    const blobs = new Map([['entries/a', ascii('a')]]);
    expect(await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs })).toBe('conflict');
    await expect(real.stat(join(root, 'mainline', 'main', 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(real.stat(lock), 'the other writer still holds its lock').resolves.toBeDefined();
  });

  it('writes no manifest and leaves no staged one behind, when its lock was taken while it wrote the manifest', async () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    const cell = createDirectoryLineCell(root);
    const line = join(root, 'mainline', 'main');
    vi.mocked(writeFile).mockImplementation((async (...args: Parameters<typeof writeFile>) => {
      if (String(args[0]).includes('manifest.json')) {
        // Stalled past the stale limit on the manifest's own bytes, after its last look at the lock.
        vi.setSystemTime(Date.now() + STALE_MS + 1_000);
        await real.rmdir(lock);
        await real.mkdir(lock);
      }
      return real.writeFile(...args);
    }) as typeof writeFile);

    const blobs = new Map([['entries/a', ascii('a')]]);
    expect(await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs })).toBe('conflict');
    expect((await readdir(line)).filter((name) => name.startsWith('manifest.json'))).toEqual([]);
    await expect(real.stat(lock), 'the other writer still holds its lock').resolves.toBeDefined();
  });

  it('stops stamping a lock it can no longer vouch for, and leaves it in place', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const cell = createDirectoryLineCell(root);
    vi.mocked(writeFile).mockImplementationOnce((async (...args: Parameters<typeof writeFile>) => {
      // Every stamp falls due while the writer is stalled, and is asked for only once it wakes past the limit.
      vi.advanceTimersByTime(STALE_MS + 1_000);
      return real.writeFile(...args);
    }) as typeof writeFile);

    const blobs = new Map([['entries/a', ascii('a')]]);
    expect(await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs })).toBe('conflict');
    expect(vi.mocked(utimes).mock.calls.filter(([path]) => path === lock)).toEqual([]);
    await expect(real.stat(lock), "a lock its holder cannot vouch for may be another writer's").resolves.toBeDefined();
  });

  it('does not count a stamp that landed after its holder stopped vouching for the lock', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const cell = createDirectoryLineCell(root);
    const asked = gate();
    const land = gate();
    vi.mocked(utimes).mockImplementationOnce((async (...args: Parameters<typeof utimes>) => {
      asked.open();
      await land.opened;
      return real.utimes(...args);
    }) as typeof utimes);
    vi.mocked(writeFile).mockImplementationOnce((async (...args: Parameters<typeof writeFile>) => {
      const start = Date.now();
      vi.advanceTimersByTime(STALE_MS / 4);
      await asked.opened;
      // The stamp lands past the three quarters of the stale limit its holder
      // vouches for, so it may land after the next writer judged the lock dead.
      vi.setSystemTime(start + (STALE_MS * 3) / 4 + 5_000);
      land.open();
      return real.writeFile(...args);
    }) as typeof writeFile);

    const blobs = new Map([['entries/a', ascii('a')]]);
    expect(await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs })).toBe('conflict');
    await expect(real.stat(join(root, 'mainline', 'main', 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(real.stat(lock), "a lock its holder cannot vouch for may be another writer's").resolves.toBeDefined();
  });

  it('answers a stamp the file system refused as refused, once the lock is no longer vouched for', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const cell = createDirectoryLineCell(root);
    vi.mocked(utimes).mockImplementation((async (path: string) => {
      throw errno('EACCES', 'permission denied, utime', path);
    }) as typeof utimes);
    vi.mocked(writeFile).mockImplementationOnce((async (...args: Parameters<typeof writeFile>) => {
      vi.advanceTimersByTime(STALE_MS / 4);
      await vi.waitFor(() => expect(utimes).toHaveBeenCalled());
      vi.advanceTimersByTime(STALE_MS / 2 + 1_000);
      return real.writeFile(...args);
    }) as typeof writeFile);

    const blobs = new Map([['entries/a', ascii('a')]]);
    const stored = await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs });
    expect(stored).toEqual({ kind: 'refused', detail: expect.stringContaining('EACCES') });
  });

  it('writes no manifest and removes nothing, when its lock is gone at its next stamp', async () => {
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const cell = createDirectoryLineCell(root);
    vi.mocked(utimes).mockImplementationOnce((async (path: string) => {
      throw errno('ENOENT', 'no such file or directory, utime', path);
    }) as typeof utimes);
    vi.mocked(writeFile).mockImplementationOnce((async (...args: Parameters<typeof writeFile>) => {
      vi.advanceTimersByTime(STALE_MS / 4);
      await vi.waitFor(() => expect(utimes).toHaveBeenCalled());
      return real.writeFile(...args);
    }) as typeof writeFile);

    const blobs = new Map([['entries/a', ascii('a')]]);
    expect(await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs })).toBe('conflict');
    await expect(real.stat(join(root, 'mainline', 'main', 'manifest.json'))).rejects.toMatchObject({ code: 'ENOENT' });
    await expect(real.stat(lock), "a lock at that path now is the next writer's").resolves.toBeDefined();
  });

  it("lets one writer break a dead writer's lock, and the other wait for the lock that writer made", async () => {
    await deadWritersLock();
    const cell = createDirectoryLineCell(root);
    // The first writer to look at the dead lock is held, its look already made,
    // until the other has broken that lock and made its own.
    const made = gate();
    let held = false;
    vi.mocked(stat).mockImplementation((async (path: string, ...rest: unknown[]) => {
      const stats = await (real.stat as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
      if (path === lock && !held) {
        held = true;
        await made.opened;
      }
      return stats;
    }) as typeof stat);
    vi.mocked(mkdir).mockImplementation((async (path: string, ...rest: unknown[]) => {
      const done = await (real.mkdir as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
      if (path === lock) made.open();
      return done;
    }) as typeof mkdir);
    // The writer that made the lock is held at its first write until the other
    // has either waited for that lock or written past it.
    const decided = gate();
    sleeps.slept = decided.open;
    let writes = 0;
    vi.mocked(writeFile).mockImplementation((async (...args: Parameters<typeof writeFile>) => {
      writes += 1;
      if (writes === 1) await decided.opened;
      else decided.open();
      return real.writeFile(...args);
    }) as typeof writeFile);

    const published = await Promise.all(['a', 'b'].map((suite) => publishLine(cell, MAIN, [entry(suite)], { descends, image })));
    expect(published).toMatchObject([{ written: ['suite-v1/a'] }, { written: ['suite-v1/b'] }]);
    expect(await suites()).toEqual(['suite-v1/a', 'suite-v1/b']);
  });

  it("leaves a dead writer's lock to the writer already breaking it", async () => {
    await deadWritersLock();
    const claim = `${lock}.${String((await real.stat(lock)).mtimeMs)}`;
    await real.mkdir(claim);
    const cell = createDirectoryLineCell(root);
    // The other writer finishes breaking the lock while this one sleeps.
    let heldWhileWaiting: boolean | undefined;
    sleeps.slept = () => {
      if (heldWhileWaiting !== undefined) return;
      heldWhileWaiting = existsSync(lock);
      rmdirSync(claim);
      rmdirSync(lock);
    };

    expect(await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map() })).toBe('written');
    expect(heldWhileWaiting, 'the lock another writer had claimed should still be there while this one waits').toBe(true);
  });

  it("breaks a claim left by a writer that died breaking a dead writer's lock", async () => {
    await deadWritersLock();
    const claim = `${lock}.${String((await real.stat(lock)).mtimeMs)}`;
    await real.mkdir(claim);
    const old = new Date(Date.now() - 2 * STALE_MS);
    await real.utimes(claim, old, old);
    const cell = createDirectoryLineCell(root);

    expect(await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map() })).toBe('written');
    expect((await readdir(join(root, 'mainline', 'main'))).filter((name) => name.startsWith('.lock'))).toEqual([]);
  });

  it("answers a dead writer's lock it cannot claim as refused", async () => {
    await deadWritersLock();
    const claim = `${lock}.${String((await real.stat(lock)).mtimeMs)}`;
    const cell = createDirectoryLineCell(root);
    vi.mocked(mkdir).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path === claim) throw errno('EACCES', 'permission denied, mkdir', claim);
      return (real.mkdir as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof mkdir);

    const stored = await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map() });
    expect(stored).toEqual({ kind: 'refused', detail: expect.stringContaining('EACCES') });
  });

  it('answers a dead claim it cannot remove as refused, after one try', async () => {
    await deadWritersLock();
    const claim = `${lock}.${String((await real.stat(lock)).mtimeMs)}`;
    await real.mkdir(claim);
    const old = new Date(Date.now() - 2 * STALE_MS);
    await real.utimes(claim, old, old);
    const cell = createDirectoryLineCell(root);
    let tries = 0;
    vi.mocked(rmdir).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path === claim && tries++ < 50) throw errno('EPERM', 'operation not permitted, rmdir', claim);
      return (real.rmdir as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof rmdir);

    const stored = await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map() });
    expect(stored).toEqual({ kind: 'refused', detail: expect.stringContaining('EPERM') });
    expect(tries).toBe(1);
  });

  it("writes after breaking a dead writer's lock, though its own claim will not go", async () => {
    await deadWritersLock();
    const claim = `${lock}.${String((await real.stat(lock)).mtimeMs)}`;
    const cell = createDirectoryLineCell(root);
    vi.mocked(rmdir).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path === claim) throw errno('EPERM', 'operation not permitted, rmdir', claim);
      return (real.rmdir as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof rmdir);

    expect(await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map() })).toBe('written');
  });

  it("answers a dead writer's lock it cannot remove as refused, after one try", async () => {
    await deadWritersLock();
    const cell = createDirectoryLineCell(root);
    let tries = 0;
    vi.mocked(rmdir).mockImplementation((async (path: string, ...rest: unknown[]) => {
      // Let go after a while, so a writer that retries without end still finishes and fails the case.
      if (path === lock && tries++ < 50) throw errno('EPERM', 'operation not permitted, rmdir', lock);
      return (real.rmdir as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof rmdir);

    const stored = await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map() });
    expect(stored).toEqual({ kind: 'refused', detail: expect.stringContaining('EPERM') });
    expect(tries).toBe(1);
    expect((await readdir(join(root, 'mainline', 'main'))).filter((name) => name.startsWith('.lock'))).toEqual(['.lock']);
  });

  it('answers a lock whose age the file system will not tell as refused, without waiting on it', async () => {
    await real.mkdir(lock, { recursive: true });
    const cell = createDirectoryLineCell(root);
    vi.mocked(stat).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path === lock) throw errno('EACCES', 'permission denied, stat', lock);
      return (real.stat as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof stat);
    sleeps.slept = () => {
      throw new Error('the writer waited on a lock whose age it could not read');
    };

    const stored = await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map() });
    expect(stored).toEqual({ kind: 'refused', detail: expect.stringContaining('EACCES') });
  });

  it('lets go of the lock when the version it was asked to write over has moved', async () => {
    const cell = createDirectoryLineCell(root);
    await publishLine(cell, MAIN, [entry('a')], { descends, image });
    expect(await cell.store(MAIN, { manifest: ascii('{}'), blobs: new Map(), expected: 'moved' })).toBe('conflict');
    await expect(real.stat(lock)).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('answers what it wrote when its lock will not go at release, and leaves the lock', async () => {
    const cell = createDirectoryLineCell(root);
    vi.mocked(rmdir).mockImplementation((async (path: string, ...rest: unknown[]) => {
      if (path === lock) throw errno('EPERM', 'operation not permitted, rmdir', lock);
      return (real.rmdir as (...args: unknown[]) => Promise<unknown>)(path, ...rest);
    }) as typeof rmdir);

    expect(await cell.store(MAIN, { manifest: ascii('{"format":1,"entries":[]}'), blobs: new Map() })).toBe('written');
    await expect(real.stat(lock)).resolves.toBeDefined();
  });
});
