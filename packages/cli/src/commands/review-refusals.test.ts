import { chmod, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { sourceIndexPath, updateSourceIndex } from '@variance-authority/sense';
import { commitRunsFile, testCoverageFile } from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { OperatorError } from '../exit.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { changed } from './review-fixture.js';
import { formatReview } from './review-text.js';
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
      expect(answer.files.every((file) => file.cases === undefined)).toBe(true);
    });

    it('reads the source index as it stands when it cannot be brought up to the checkout, and still says the record ran the change', async () => {
      const { root, first, against } = await changed();
      await updateSourceIndex(root);
      // Written after the index was: the update has something to write, and the directory refuses it.
      await writeFile(join(root, 'NOTES.md'), 'notes\n');
      const index = dirname(sourceIndexPath(root));
      await chmod(index, 0o555);
      try {
        const answer = await review(parse(['--since', first, '--against', against, '--root', root]));

        expect(answer).toMatchObject({ from: first, record: 'ran', base: 'since' });
      } finally {
        await chmod(index, 0o755);
      }
    });

    it('says beside the answer that the record could not be read, and what that leaves open', async () => {
      const { root, first } = await changed();
      const runs = commitRunsFile(testCoverageFile(root));
      await mkdir(runs, { recursive: true });

      const answer = await review(parse(['--since', first, '--root', root]));
      const gap = `The runs record at ${runs} could not be read`;

      expect(answer.runsUnread).toMatch(new RegExp(`^${gap.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&')}.*so which test files the runs wrote cannot be said, and no case is said to have moved\\.$`, 'su'));
      expect(formatReview(answer, 'text')).toContain(`\n\n${answer.runsUnread}\n`);
      expect(formatReview(answer, 'markdown')).toContain(`<sub>${answer.runsUnread}</sub>`);
    });
  });

  it('refuses a format it does not write', () => {
    expect(() => parse(['--format', 'html'])).toThrow(/--format must be text, markdown, json or handover/);
  });
});
