import { vi } from 'vitest';
import { native } from '../../addon.js';
import type { NativeScanner } from '../../native.js';

/**
 * How often `run` had the addon read a path at a commit, by `reads(commit, file)`.
 *
 * Counted where a read leaves for git, because `gitStarted` sees processes and a
 * read on an open `cat-file` starts none.
 */
export function gitReads(run: () => void): (commit: string, file: string) => number {
  const addon = native() as Required<NativeScanner>;
  const counted = new Map<string, number>();
  const count = (commit: string, file: string): void => {
    counted.set(`${commit}\0${file}`, (counted.get(`${commit}\0${file}`) ?? 0) + 1);
  };
  const many = vi.spyOn(addon, 'textsAt');
  const one = vi.spyOn(addon, 'textAt');
  try {
    run();
    for (const [, commits, paths] of many.mock.calls) {
      commits.forEach((commit, at) => paths[at]!.forEach((file) => count(commit, file)));
    }
    for (const [, commit, file] of one.mock.calls) count(commit, file);
  } finally {
    many.mockRestore();
    one.mockRestore();
  }
  return (commit, file) => counted.get(`${commit}\0${file}`) ?? 0;
}
