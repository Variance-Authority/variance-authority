import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { OperatorError } from '../exit.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { REVIEW_ARTIFACT, reviewFromRun, runOf } from './review-from-run.js';

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
