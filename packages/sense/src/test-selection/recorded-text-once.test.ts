import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitStarted } from './__fixtures__/git-started.js';
import { textAtRecording } from './recorded-text.js';

/** More paths than the first window reads, so a path can outlive the window that read it. */
const FILES = 100;
const ASKS = 5;
const ABSENT = 'src/added-since.ts';
const path = (at: number): string => `src/f${`${at}`.padStart(3, '0')}.ts`;
const body = (at: number): string => `export const at = ${at};\n`;
const since = (at: number): string => `export const at = ${at}; // since\n`;
const all = Array.from({ length: FILES }, (_, at) => at);

/** A checkout a commit past `first`, whose every file differs from it and whose `path(0)` differs on disk from both. */
function checkout(run: (root: string, first: string) => void): void {
  const root = mkdtempSync(resolve(tmpdir(), 'variance-recorded-once-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (text: (at: number) => string): void => {
    for (const at of all) writeFileSync(resolve(root, path(at)), text(at));
  };
  try {
    mkdirSync(resolve(root, 'src'));
    git('init', '--quiet');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Fixture');
    write(body);
    git('add', '--all');
    git('commit', '--quiet', '--message', 'the text the ranges were cut from');
    const first = git('rev-parse', 'HEAD');
    write(since);
    git('commit', '--quiet', '--all', '--message', 'since');
    writeFileSync(resolve(root, path(0)), 'export const at = "on disk";\n');
    run(root, first);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

/** How many of `started`'s tree listings named `file`: the one place a path reaches git, for a text or for none. */
const listings = (started: readonly string[][], file: string): number =>
  started.filter((argv) => argv.includes('ls-tree') && argv.includes(file)).length;
const texts = (started: readonly string[][]): number => started.filter((argv) => argv.includes('--batch')).length;

describe('a path no window read reaches git once at a commit', () => {
  it('when it differs on disk or the commit does not hold it, however often it is asked', () => {
    checkout((root, first) => {
      const sourceAt = textAtRecording(root, []);
      // The listing starts from the second path from outside the set, so both are asked past it.
      expect(sourceAt(path(1), first)).toBe(body(1));
      const started = gitStarted(root, () => {
        for (let ask = 0; ask < ASKS; ask += 1) {
          expect(sourceAt(path(0), first)).toBe(body(0));
          expect(sourceAt(ABSENT, first)).toBeUndefined();
        }
      });

      expect(listings(started, path(0))).toBe(1);
      expect(listings(started, ABSENT)).toBe(1);
      expect(texts(started)).toBe(1);
    });
  });
});

describe('a path a window read reaches git at most twice at a commit', () => {
  it('when it is asked again and again after that window went', () => {
    checkout((root, first) => {
      const named = [...all.map(path), ABSENT].sort();
      const sourceAt = textAtRecording(root, named);
      const started = gitStarted(root, () => {
        for (let ask = 0; ask < ASKS; ask += 1) {
          for (const at of all) expect(sourceAt(path(at), first), path(at)).toBe(body(at));
          expect(sourceAt(ABSENT, first)).toBeUndefined();
        }
      });

      for (const file of named) expect(listings(started, file), file).toBeLessThanOrEqual(2);
    });
  });

  it('when a jump ahead took that window away before the path was asked, and it is asked again and again', () => {
    checkout((root, first) => {
      const sourceAt = textAtRecording(root, all.map(path));
      const started = gitStarted(root, () => {
        expect(sourceAt(path(20), first)).toBe(body(20));
        expect(sourceAt(path(FILES - 1), first)).toBe(body(FILES - 1));
        for (let ask = 0; ask < ASKS; ask += 1) {
          for (const at of all) expect(sourceAt(path(at), first), path(at)).toBe(body(at));
        }
      });

      for (const at of all) expect(listings(started, path(at)), path(at)).toBeLessThanOrEqual(2);
    });
  });

  it('when two windows went before the path was asked', () => {
    checkout((root, first) => {
      const sourceAt = textAtRecording(root, all.map(path));
      const started = gitStarted(root, () => {
        for (const at of [20, FILES - 1, 21, 0]) expect(sourceAt(path(at), first)).toBe(body(at));
        for (let ask = 0; ask < ASKS; ask += 1) {
          for (const at of all) expect(sourceAt(path(at), first), path(at)).toBe(body(at));
        }
      });

      for (const at of all) expect(listings(started, path(at)), path(at)).toBeLessThanOrEqual(2);
    });
  });
});

describe('a read git refused', () => {
  it('is not held as the path being absent, and fails again, from a window or outside one', () => {
    checkout((root) => {
      const missing = '0'.repeat(40);
      for (const named of [[], [path(0)]]) {
        const sourceAt = textAtRecording(root, named);
        expect(() => sourceAt(path(0), missing)).toThrow(/not in this checkout's object store/);
        expect(() => sourceAt(path(0), missing)).toThrow(/not in this checkout's object store/);
      }
    });
  });
});
