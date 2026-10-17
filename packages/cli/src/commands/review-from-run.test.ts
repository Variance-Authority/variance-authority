import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readFlags } from '../args.js';
import { OperatorError } from '../exit.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { REVIEW_ARTIFACT, reviewFromRun, runOf } from './review-from-run.js';

// A review.json past the longest string V8 holds takes gigabytes to write, so the read says it was one.
const tooLong = vi.hoisted(() => ({ now: false }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  const readFile = (async (...args: Parameters<typeof fs.readFile>) => {
    if (tooLong.now) throw Object.assign(new Error('Cannot create a string longer than 0x1fffffe8 characters'), { code: 'ERR_STRING_TOO_LONG' });
    return fs.readFile(...args);
  }) as typeof fs.readFile;
  return { ...fs, readFile };
});

function parse(argv: readonly string[]) {
  return parseReviewArgs(readFlags(argv, 'review', flagsFor('review'), synopsisFor('review')));
}

describe('the review a CI run kept', () => {
  it('names a run by id, or by the URL of the run or one of its jobs', () => {
    expect(runOf('36531792356')).toEqual({ id: '36531792356' });
    expect(runOf('https://github.com/acme/shop/actions/runs/36531792356/job/9')).toEqual({ id: '36531792356', repo: 'acme/shop' });
    expect(() => runOf('last')).toThrow(OperatorError);
  });

  it('downloads the artifact with gh and reads the review.json it holds', async () => {
    const calls: (readonly string[])[] = [];
    const answer = await reviewFromRun({ run: 'https://github.com/acme/shop/actions/runs/7', artifact: REVIEW_ARTIFACT, root: process.cwd() }, async (file, args) => {
      calls.push([file, ...args]);
      await writeFile(join(args[args.indexOf('--dir') + 1]!, 'review.json'), JSON.stringify({ files: [] }));
    });
    expect(answer).toEqual({ files: [] });
    expect(calls).toEqual([['gh', 'run', 'download', '7', '--name', 'variance-review', '--dir', expect.any(String), '--repo', 'acme/shop']]);
  });

  it('says a review.json too long to read is there, rather than that the artifact holds none', async () => {
    tooLong.now = true;
    try {
      const read = reviewFromRun({ run: '7', artifact: REVIEW_ARTIFACT, root: process.cwd() }, async (_file, args) => {
        await writeFile(join(args[args.indexOf('--dir') + 1]!, 'review.json'), '{}');
      });
      await expect(read).rejects.toThrow(/run 7's artifact `variance-review` holds a review\.json longer than one string can hold/);
    } finally {
      tooLong.now = false;
    }
  });

  it.todo('reads a review.json past the longest string V8 holds, which `review --out` writes for a large change — needs each case written once and named by id, or a parse that streams');

  it('says gh is missing rather than that the run is', async () => {
    const missing = Object.assign(new Error('spawn gh ENOENT'), { code: 'ENOENT' });
    await expect(reviewFromRun({ run: '7', artifact: REVIEW_ARTIFACT, root: process.cwd() }, () => Promise.reject(missing))).rejects.toThrow(/`gh` is not on the PATH/);
    const expired = Object.assign(new Error('exit 1'), { stderr: 'no artifact matches any of the names or patterns provided\n' });
    await expect(reviewFromRun({ run: '7', artifact: REVIEW_ARTIFACT, root: process.cwd() }, () => Promise.reject(expired))).rejects.toThrow(/failed: no artifact matches/);
  });

  it('refuses a flag that would change a review the run already made', () => {
    expect(parse(['--from-run', '7'])).toMatchObject({ fromRun: '7', artifact: 'variance-review' });
    expect(() => parse(['--from-run', '7', '--since', 'main'])).toThrow(/--since has nothing to change/);
    expect(() => parse(['--artifact', 'x'])).toThrow(/no `--from-run` was given/);
  });
});
