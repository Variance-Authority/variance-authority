import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { gitReads } from './__fixtures__/git-reads.js';
import { gitStarted } from './__fixtures__/git-started.js';
import { HELD_BYTES, textAtRecording } from './recorded-text.js';

const FILES = 100;
const ASKS = 5;
const ABSENT = 'src/added-since.ts';
const path = (at: number): string => `src/f${`${at}`.padStart(3, '0')}.ts`;
const body = (at: number): string => `export const at = ${at};\n`;
const since = (at: number): string => `export const at = ${at}; // since\n`;
const all = Array.from({ length: FILES }, (_, at) => at);

/** A text of `size` bytes, each file's its own. */
const sized = (size: number) => (at: number): string => `// ${at}\n`.padEnd(size, 'x');
/** A size a text can take, `LARGE` of which are three times what is held. */
const TEXT = 512 * 1024;
const LARGE = (3 * HELD_BYTES) / TEXT;
/** How many of the most recent `TEXT`s stay held, one short of the bound's quotient for what each entry costs beside its text. */
const STAY = HELD_BYTES / TEXT - 1;

/** A checkout a commit past `first`, whose every file differs from it and whose `path(0)` differs on disk from both. */
function checkout(run: (root: string, first: string, second: string) => void, count = FILES, text = body): void {
  const root = mkdtempSync(resolve(tmpdir(), 'variance-recorded-once-'));
  const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
  const write = (written: (at: number) => string): void => {
    for (let at = 0; at < count; at += 1) writeFileSync(resolve(root, path(at)), written(at));
  };
  try {
    mkdirSync(resolve(root, 'src'));
    git('init', '--quiet');
    git('config', 'user.email', 'fixture@example.invalid');
    git('config', 'user.name', 'Fixture');
    write(text);
    git('add', '--all');
    git('commit', '--quiet', '--message', 'the text the ranges were cut from');
    const first = git('rev-parse', 'HEAD');
    write(text === body ? since : (at) => `${text(at)}// since\n`);
    git('commit', '--quiet', '--all', '--message', 'since');
    writeFileSync(resolve(root, path(0)), 'export const at = "on disk";\n');
    run(root, first, git('rev-parse', 'HEAD'));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

describe('what was asked fits what is held, so a path reaches git once at a commit', () => {
  it('when it differs on disk or the commit does not hold it, however often it is asked', () => {
    checkout((root, first) => {
      const sourceAt = textAtRecording(root, []);
      const reads = gitReads(() => {
        for (let ask = 0; ask < ASKS; ask += 1) {
          expect(sourceAt(path(0), first)).toBe(body(0));
          expect(sourceAt(ABSENT, first)).toBeUndefined();
        }
      });

      expect(reads(first, path(0))).toBe(1);
      expect(reads(first, ABSENT)).toBe(1);
    });
  });

  it.each([
    ['in order', []],
    ['after a jump ahead', [20, FILES - 1]],
    ['after two jumps ahead and back', [20, FILES - 1, 21, 0]],
  ])('%s, asked again and again', (_, jumps) => {
    checkout((root, first) => {
      const named = [...all.map(path), ABSENT].sort();
      const sourceAt = textAtRecording(root, named);
      const reads = gitReads(() => {
        for (const at of jumps) expect(sourceAt(path(at), first)).toBe(body(at));
        for (let ask = 0; ask < ASKS; ask += 1) {
          for (const at of all) expect(sourceAt(path(at), first), path(at)).toBe(body(at));
          expect(sourceAt(ABSENT, first)).toBeUndefined();
        }
      });

      for (const file of named) expect(reads(first, file), file).toBe(1);
    });
  });

  it('at each of two commits asked in turn', () => {
    checkout((root, first, second) => {
      const sourceAt = textAtRecording(root, all.map(path));
      const reads = gitReads(() => {
        for (let ask = 0; ask < ASKS; ask += 1) {
          for (const at of all) {
            expect(sourceAt(path(at), first), path(at)).toBe(body(at));
            expect(sourceAt(path(at), second), path(at)).toBe(since(at));
          }
        }
      });

      for (const at of all) {
        expect(reads(first, path(at)), path(at)).toBe(1);
        expect(reads(second, path(at)), path(at)).toBe(1);
      }
    });
  });
});

describe('what was asked is more than is held', () => {
  const large = sized(TEXT);
  const paths = Array.from({ length: LARGE }, (_, at) => at);

  it('keeps the texts asked last, starts no process past the first, and answers every ask', () => {
    checkout((root, first) => {
      const sourceAt = textAtRecording(root, paths.map(path));
      let reads = (_commit: string, _file: string): number => 0;
      const started = gitStarted(root, () => {
        reads = gitReads(() => {
          // A jump through every other path, the rest, then every path again in order.
          for (const at of [...paths.filter((at) => at % 2 === 0), ...paths.filter((at) => at % 2 === 1), ...paths]) {
            expect(sourceAt(path(at), first) === large(at), path(at)).toBe(true);
          }
        });
      });

      expect(started.filter((argv) => argv[1] !== 'config').map((argv) => argv[1])).toEqual(['cat-file']);
      // Asked twice, with more than is held between the asks.
      expect(reads(first, path(0))).toBe(2);

      const held = paths.slice(-STAY).reverse();
      const again = gitReads(() => {
        for (const at of held) expect(sourceAt(path(at), first) === large(at), path(at)).toBe(true);
        expect(sourceAt(path(LARGE - STAY - 2), first) === large(LARGE - STAY - 2)).toBe(true);
      });

      for (const at of held) expect(again(first, path(at)), path(at)).toBe(0);
      expect(again(first, path(LARGE - STAY - 2))).toBe(1);
    }, LARGE, large);
  });

  it('stays within it round after round across two commits, with no process past the first', () => {
    const rounds = 3;
    const since = (at: number): string => `${large(at)}// since\n`;
    checkout((root, first, second) => {
      const asks = paths.flatMap((at) => [{ at, commit: first, text: large(at) }, { at, commit: second, text: since(at) }]);
      const ask = ({ at, commit, text }: (typeof asks)[number]): void => {
        expect(sourceAt(path(at), commit) === text, `${path(at)} at ${commit}`).toBe(true);
      };
      const sourceAt = textAtRecording(root, paths.map(path));
      let reads = (_commit: string, _file: string): number => 0;
      const started = gitStarted(root, () => {
        reads = gitReads(() => {
          for (let round = 0; round < rounds; round += 1) asks.forEach(ask);
        });
      });

      expect(started.filter((argv) => argv[1] !== 'config').map((argv) => argv[1])).toEqual(['cat-file']);
      // A round asks three times what is held, so nothing outlives the round after it.
      for (const { at, commit } of asks) expect(reads(commit, path(at)), `${path(at)} at ${commit}`).toBe(rounds);

      const held = asks.slice(-STAY).reverse();
      const gone = asks.at(-STAY - 2)!;
      const again = gitReads(() => {
        held.forEach(ask);
        ask(gone);
      });

      for (const { at, commit } of held) expect(again(commit, path(at)), `${path(at)} at ${commit}`).toBe(0);
      expect(again(gone.commit, path(gone.at))).toBe(1);
    }, LARGE, large);
  });

  it('answers a path the commit does not hold with no process, then and after it went', () => {
    checkout((root, first) => {
      const sourceAt = textAtRecording(root, paths.map(path));
      expect(sourceAt(path(1), first) === large(1)).toBe(true);
      const started = gitStarted(root, () => {
        expect(sourceAt(ABSENT, first)).toBeUndefined();
        for (const at of paths) sourceAt(path(at), first);
        expect(sourceAt(ABSENT, first)).toBeUndefined();
      });

      expect(started).toEqual([]);
    }, LARGE, large);
  });

  it('answers a text larger than all of it without holding it or letting go of what is', () => {
    const texts = (at: number): string => (at === 1 ? sized(HELD_BYTES + TEXT)(at) : body(at));
    checkout((root, first) => {
      const sourceAt = textAtRecording(root, [path(1), path(2)]);
      const reads = gitReads(() => {
        for (let ask = 0; ask < ASKS; ask += 1) {
          expect(sourceAt(path(2), first)).toBe(body(2));
          expect(sourceAt(path(1), first) === texts(1)).toBe(true);
        }
      });

      expect(reads(first, path(2))).toBe(1);
      expect(reads(first, path(1))).toBe(ASKS);
    }, 3, texts);
  });
});

describe('what a name says at a commit', () => {
  it('is nothing for a directory, and the text for a path with a space', () => {
    const spaced = 'src/with a space.ts';
    checkout((root, first) => {
      const git = (...args: string[]): string => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
      writeFileSync(resolve(root, spaced), body(1));
      git('add', '--all');
      git('commit', '--quiet', '--message', 'a name with a space');
      const second = git('rev-parse', 'HEAD');
      const sourceAt = textAtRecording(root, []);

      expect(sourceAt('src', first)).toBeUndefined();
      expect(sourceAt(spaced, first)).toBeUndefined();
      expect(sourceAt(spaced, second)).toBe(body(1));
    });
  });

  it('is the checkout\'s own when two checkouts are asked in turn', () => {
    const other = (at: number): string => `export const other = ${at};\n`;
    checkout((root, first) => {
      checkout((elsewhere, commit) => {
        const here = textAtRecording(root, []);
        const there = textAtRecording(elsewhere, []);
        for (const at of [1, 2, 3]) {
          expect(here(path(at), first)).toBe(body(at));
          expect(there(path(at), commit)).toBe(other(at));
        }
      }, 4, other);
    });
  });
});

describe('a read git refused', () => {
  it('is not held as the path being absent, and fails again, named or not', () => {
    checkout((root) => {
      const missing = '0'.repeat(40);
      for (const named of [[], [path(0)]]) {
        const sourceAt = textAtRecording(root, named);
        expect(() => sourceAt(path(0), missing)).toThrow(/not in this checkout's object store/);
        expect(() => sourceAt(path(0), missing)).toThrow(/not in this checkout's object store/);
      }
    });
  });

  it('lets go of nothing that is held', () => {
    checkout((root, first) => {
      const sourceAt = textAtRecording(root, []);
      expect(sourceAt(path(1), first)).toBe(body(1));
      const reads = gitReads(() => {
        expect(() => sourceAt(path(1), '0'.repeat(40))).toThrow(/not in this checkout's object store/);
        expect(sourceAt(path(1), first)).toBe(body(1));
      });

      expect(reads(first, path(1))).toBe(0);
    });
  });
});
