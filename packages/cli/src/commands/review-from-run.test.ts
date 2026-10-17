import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { readFlags } from '../args.js';
import { OperatorError } from '../exit.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { REVIEW_ARTIFACT, reviewFromRun, runOf } from './review-from-run.js';
import { reviewPieces } from './review-text.js';
import type { Review } from './review.js';

// A review.json past the longest string V8 holds takes gigabytes to write, so the file read here refuses, as V8
// would, to spell itself whole: as a string, or as one string from its bytes.
const tooLong = vi.hoisted(() => ({ now: false }));
vi.mock('node:fs/promises', async (original) => {
  const fs = await original<typeof import('node:fs/promises')>();
  const refuse = () => Object.assign(new Error('Cannot create a string longer than 0x1fffffe8 characters'), { code: 'ERR_STRING_TOO_LONG' });
  const readFile = (async (...args: Parameters<typeof fs.readFile>) => {
    if (!tooLong.now) return fs.readFile(...args);
    if (args[1] !== undefined) throw refuse();
    const bytes = (await fs.readFile(...args)) as Buffer;
    const spell = bytes.toString.bind(bytes);
    return Object.assign(bytes, {
      toString: (encoding?: BufferEncoding, from = 0, to = bytes.length) => {
        if (to - from >= bytes.length) throw refuse();
        return spell(encoding, from, to);
      },
    });
  }) as typeof fs.readFile;
  return { ...fs, readFile };
});

/** The review.json a run's `--out` kept for `review`. */
async function kept(into: string, review: Review): Promise<void> {
  await writeFile(join(into, 'review.json'), [...reviewPieces(review, 'json')].join(''));
}

const ran: Review = {
  from: 'cc25d6a6', base: 'since', record: 'ran',
  files: [{ file: 'src/a.ts', regions: [{
    kind: 'function', name: 'a', startLine: 1, endLine: 2, reach: 'near', edit: 'modified', cases: 1, changedLineCases: 1,
    tests: ['test/a.test.ts'], called: [{ id: 'test/a.test.ts > runs a', file: 'test/a.test.ts', name: 'runs a', preconditions: [] }],
  }] }],
};

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

  it('reads a review.json past the longest string V8 holds, which `review --out` writes for a large change', async () => {
    tooLong.now = true;
    try {
      const read = await reviewFromRun({ run: '7', artifact: REVIEW_ARTIFACT, root: process.cwd() }, async (_file, args) => {
        await kept(args[args.indexOf('--dir') + 1]!, ran);
      });
      expect(read).toEqual(ran);
    } finally {
      tooLong.now = false;
    }
  });

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
