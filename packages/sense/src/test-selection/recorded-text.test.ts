import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';
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
