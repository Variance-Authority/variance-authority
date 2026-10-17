import { mkdir, mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { commitRunsFile, testCoverageFile } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { OperatorError } from '../exit.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { changed } from './review-fixture.js';
import { review } from './review.js';

function parse(argv: readonly string[]) {
  return parseReviewArgs(readFlags(argv, 'review', flagsFor('review'), synopsisFor('review')));
}

describe('a review that cannot be made', () => {
  it('is refused as unrecorded when no run listed itself and no base is named', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-review-bare-'));

    const refused = review(parse(['--root', root]));
    await expect(refused).rejects.toThrow(/no run has listed itself.*nothing records where this change starts\. Name the base with `--since <ref>`\./su);
    await expect(refused).rejects.not.toThrow(/[Rr]un the suite/);
  });

  it('refuses a runs record that is there and cannot be read, as an operator error naming it', async () => {
    const root = await mkdtemp(join(tmpdir(), 'variance-review-unread-'));
    const runs = commitRunsFile(testCoverageFile(root));
    await mkdir(runs, { recursive: true });

    const refused = review(parse(['--root', root]));

    await expect(refused).rejects.toBeInstanceOf(OperatorError);
    await expect(refused).rejects.toThrow(`the runs record at ${runs} could not be read`);
    await expect(refused).rejects.toThrow(
      /It records where this change starts, and a review that read it as absent would start from a guess\. Name the base with `--since <ref>`\.$/,
    );
    await expect(refused).rejects.not.toThrow(/run the suite|delete it/i);
  });

  describe('with the base named', () => {
    const cwd = process.cwd();
    afterEach(() => process.chdir(cwd));

    it('answers from it, rather than refusing a record it no longer needs for the start', async () => {
      const { root, first } = await changed();
      await mkdir(commitRunsFile(testCoverageFile(root)), { recursive: true });

      const answer = await review(parse(['--since', first, '--root', root]));

      expect(answer).toMatchObject({ base: 'since', from: first });
      expect(answer.runs).toBeUndefined();
      expect(answer.motion).toBeUndefined();
      expect(answer.files.map((file) => file.file)).toContain('src/total.ts');
    });
  });

  it('refuses a format it does not write', () => {
    expect(() => parse(['--format', 'html'])).toThrow(/--format must be text, markdown, json or handover/);
  });
});
