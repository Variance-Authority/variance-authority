import { execFile } from 'node:child_process';
import { existsSync, readFileSync, rmSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { delimiter, join, resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it, vi } from 'vitest';
import { nativeAvailable } from '../native.js';
import { textAtRecording } from './recorded-text.js';

/**
 * More paths than one window holds, so the answers below cross a window edge
 * rather than all arriving from the first read. The reader sizes its second
 * window from the bytes the first one returned, so the files are given a body
 * worth measuring instead of a single line.
 */
const FILES = 150;
const path = (at: number): string => `src/f${`${at}`.padStart(3, '0')}.ts`;
const body = (at: number): string => `export const at = ${at};\n${'// '.repeat(200)}\n`;

async function checkout<T>(run: (root: string, commit: string) => Promise<T>): Promise<T> {
  const root = await mkdtemp(resolve(tmpdir(), 'variance-recorded-text-'));
  try {
    await mkdir(resolve(root, 'src'));
    for (let at = 0; at < FILES; at += 1) {
      await writeFile(resolve(root, path(at)), body(at), 'utf8');
    }
    const git = async (...args: string[]): Promise<string> =>
      (await promisify(execFile)('git', args, { cwd: root })).stdout.trim();
    await git('init', '--quiet');
    await git('config', 'user.email', 'fixture@example.invalid');
    await git('config', 'user.name', 'Fixture');
    await git('add', '--all');
    await git('commit', '--quiet', '--message', 'the text the ranges were cut from');
    return await run(root, await git('rev-parse', 'HEAD'));
  } finally {
    await rm(root, { recursive: true, force: true });
  }
}

const every = (from: number, to: number): number[] =>
  Array.from({ length: to - from }, (_, at) => from + at);

describe('the text at a recording is read a window at a time', () => {
  it('answers every path the caller named, across the window edges', async () => {
    await checkout(async (root, commit) => {
      const sourceAt = textAtRecording(
        root,
        every(0, FILES).map(path),
      );

      for (const at of every(0, FILES)) {
        expect(sourceAt(path(at), commit), path(at)).toBe(body(at));
      }
    });
  });

  it('answers a path the window has already rolled past', async () => {
    await checkout(async (root, commit) => {
      const sourceAt = textAtRecording(
        root,
        every(0, FILES).map(path),
      );

      // Forward to the far end, which leaves every earlier path behind, then
      // back for twenty of them. A window that only ever moved forward would
      // have nothing to say about these.
      expect(sourceAt(path(FILES - 1), commit)).toBe(body(FILES - 1));
      for (const at of every(0, 20).reverse()) {
        expect(sourceAt(path(at), commit), path(at)).toBe(body(at));
      }
    });
  });

  it('answers a path the caller never named', async () => {
    await checkout(async (root, commit) => {
      // The list is what the reads are sized by, not what may be asked: a
      // caller that narrowed it to the paths it holds a digest for must still
      // get an answer for anything else the selector reaches.
      const sourceAt = textAtRecording(root, [path(0)]);

      expect(sourceAt(path(100), commit)).toBe(body(100));
      expect(sourceAt(path(0), commit)).toBe(body(0));
    });
  });

  it('answers nothing for a path the commit does not hold, and keeps answering it', async () => {
    await checkout(async (root, commit) => {
      const sourceAt = textAtRecording(root, ['src/added-since.ts', path(0)]);

      expect(sourceAt('src/added-since.ts', commit)).toBeUndefined();
      expect(sourceAt('src/added-since.ts', commit)).toBeUndefined();
      expect(sourceAt(path(0), commit)).toBe(body(0));
    });
  });

  it('answers nothing at all without a position to read from', async () => {
    await checkout(async (root) => {
      const sourceAt = textAtRecording(root, [path(0)]);

      expect(sourceAt(path(0), undefined)).toBeUndefined();
    });
  });
});

/** The Git commands `run` started, as argv, read from Git's own trace. */
function gitStarted(root: string, run: () => void): string[][] {
  const trace = resolve(root, '.git', 'variance-trace.json');
  rmSync(trace, { force: true });
  vi.stubEnv('GIT_TRACE2_EVENT', trace);
  try {
    run();
  } finally {
    vi.unstubAllEnvs();
  }
  const lines = existsSync(trace) ? readFileSync(trace, 'utf8').trim().split('\n') : [];
  return lines
    .map((line) => JSON.parse(line) as { event: string; argv?: string[] })
    .filter((event) => event.event === 'start')
    .map((event) => event.argv ?? []);
}

describe('the text at a recording of a path the caller never named', () => {
  it('is read for a hundred paths in as many processes as for ten', async () => {
    await checkout(async (root, commit) => {
      const asked = (count: number): string[][] => {
        const sourceAt = textAtRecording(root, [path(FILES - 1)]);
        return gitStarted(root, () => {
          for (const at of every(0, count)) expect(sourceAt(path(at), commit), path(at)).toBe(body(at));
        });
      };

      const few = asked(10);
      expect(few.length).toBeGreaterThan(0);
      expect(asked(100).length).toBe(few.length);
    });
  });

  it('leaves the window it arrived in place', async () => {
    await checkout(async (root, commit) => {
      const sourceAt = textAtRecording(root, every(0, 50).map(path));
      expect(sourceAt(path(0), commit)).toBe(body(0));
      expect(sourceAt(path(120), commit)).toBe(body(120));

      // The window that answered `path(0)` holds these, so none is read again.
      const started = gitStarted(root, () => {
        for (const at of every(1, 50)) expect(sourceAt(path(at), commit), path(at)).toBe(body(at));
      });
      expect(started).toEqual([]);
    });
  });

  it('is the commit\'s text when the file on disk was edited, deleted or added since', async () => {
    await checkout(async (root, commit) => {
      await writeFile(resolve(root, path(10)), `${body(10)}// since\n`, 'utf8');
      await unlink(resolve(root, path(11)));
      await writeFile(resolve(root, 'src/added-since.ts'), 'export {};\n', 'utf8');
      const sourceAt = textAtRecording(root, [path(FILES - 1)]);

      // Two paths first, so the three below are asked after the reader has
      // had reason to stop reading each one alone.
      expect(sourceAt(path(0), commit)).toBe(body(0));
      expect(sourceAt(path(1), commit)).toBe(body(1));
      expect(sourceAt(path(10), commit)).toBe(body(10));
      expect(sourceAt(path(11), commit)).toBe(body(11));
      expect(sourceAt('src/added-since.ts', commit)).toBeUndefined();
    });
  });
});

/**
 * A blobless clone of a source holding `every(0, 5)` at a commit and edits
 * after it, whose server writes a line to `requests` per request it answers.
 */
async function partialClone(
  run: (clone: string, commit: string, requests: () => Promise<number>, base: string) => Promise<void>,
): Promise<void> {
  const base = await mkdtemp(resolve(tmpdir(), 'variance-recorded-partial-'));
  const [source, clone, requests, serve] = ['source', 'clone', 'requests', 'serve'].map((name) => resolve(base, name));
  const git = async (at: string, ...args: string[]): Promise<string> =>
    (await promisify(execFile)('git', args, { cwd: at })).stdout.trim();
  try {
    await mkdir(resolve(source, 'src'), { recursive: true });
    for (const at of every(0, 5)) await writeFile(resolve(source, path(at)), then(at), 'utf8');
    await git(source, 'init', '--quiet');
    await git(source, 'config', 'user.email', 'fixture@example.invalid');
    await git(source, 'config', 'user.name', 'Fixture');
    await git(source, 'config', 'uploadpack.allowFilter', 'true');
    await git(source, 'config', 'uploadpack.allowAnySHA1InWant', 'true');
    await git(source, 'add', '--all');
    await git(source, 'commit', '--quiet', '--message', 'the text the ranges were cut from');
    const commit = await git(source, 'rev-parse', 'HEAD');
    for (const at of every(0, 5)) await writeFile(resolve(source, path(at)), `${then(at)}// since\n`, 'utf8');
    await writeFile(resolve(source, 'src/added-since.ts'), 'export {};\n', 'utf8');
    await git(source, 'add', '--all');
    await git(source, 'commit', '--quiet', '--message', 'since');

    await writeFile(serve, `#!/bin/sh\necho request >> '${requests}'\nexec git upload-pack "$@"\n`, { mode: 0o755 });
    await git(base, 'clone', '--quiet', '--filter=blob:none', `file://${source}`, clone);
    await git(clone, 'config', 'remote.origin.uploadpack', serve);
    await writeFile(requests, '', 'utf8');
    const answered = async (): Promise<number> => (await readFile(requests, 'utf8')).split('\n').filter(Boolean).length;
    await run(clone, commit, answered, base);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

const then = (at: number): string => `export const at = ${at};\n`;

describe('the text at a recording in a partial clone', () => {
  it.runIf(nativeAvailable())('is fetched for a whole window in one request', async () => {
    await partialClone(async (clone, commit, requests) => {
      const sourceAt = textAtRecording(clone, [...every(0, 5).map(path), 'src/added-since.ts']);
      for (const at of every(0, 5)) expect(sourceAt(path(at), commit), path(at)).toBe(then(at));
      expect(sourceAt('src/added-since.ts', commit)).toBeUndefined();
      expect(await requests()).toBe(1);
    });
  });

  // Git 2.43, the one Ubuntu 24.04 ships, exits at the first object it may
  // not fetch instead of answering `missing`, as this shim does.
  it.runIf(nativeAvailable() && process.platform !== 'win32')('is fetched in one request from a git that stops at the first object it may not fetch', async () => {
    await partialClone(async (clone, commit, requests, base) => {
      const searched = process.env['PATH'] ?? '';
      const real = searched.split(delimiter).map((dir) => join(dir, 'git')).find((file) => existsSync(file))!;
      const shim = resolve(base, 'bin');
      await mkdir(shim);
      const stops = `[ -n "$GIT_NO_LAZY_FETCH" ] && [ "$1" = cat-file ] && { echo 'fatal: could not fetch' >&2; exit 128; }`;
      await writeFile(resolve(shim, 'git'), `#!/bin/sh\n${stops}\nexec '${real}' "$@"\n`, { mode: 0o755 });
      process.env['PATH'] = `${shim}${delimiter}${searched}`;
      try {
        const sourceAt = textAtRecording(clone, every(0, 5).map(path));
        for (const at of every(0, 5)) expect(sourceAt(path(at), commit), path(at)).toBe(then(at));
      } finally {
        process.env['PATH'] = searched;
      }
      expect(await requests()).toBe(1);
    });
  });
});
