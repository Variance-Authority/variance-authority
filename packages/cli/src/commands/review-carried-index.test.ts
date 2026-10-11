import { testCoverageFile } from '@variance-authority/sense/test-selection';
import { afterEach, describe, expect, it } from 'vitest';
import { readFlags } from '../args.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { review } from './review.js';
import { formatReview } from './review-text.js';
import { AFTER_LINES, LEAD, LEAD_LINES, ROUNDS, block, changed, recordTotal } from './review-fixture.js';

function parse(argv: readonly string[]) {
  return parseReviewArgs(readFlags(argv, 'review', flagsFor('review'), synopsisFor('review')));
}

/**
 * A run that skips every test file it selected keeps no case: its snapshot is
 * re-cut to the tree, where a line written above both functions moved them
 * down, while its case index is carried at the lines of the text before.
 */
describe('a review of a suite whose case index was carried past its snapshot', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it('takes no region from another suite whose cases were cut at other text than its snapshot', async () => {
    const { root, first, against } = await changed({ suites: ['unit', 'browser'], tree: LEAD, lines: LEAD_LINES });
    await recordTotal(testCoverageFile(root, { suite: 'browser' }), {
      commit: first,
      text: LEAD,
      lines: LEAD_LINES,
      tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
      entered: { applyDiscount: [], round: [] },
      index: { tests: [ROUNDS], modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', ...AFTER_LINES.applyDiscount, []), block('round', ...AFTER_LINES.round, [])] }] },
    });
    const answer = await review(parse(['--since', first, '--against', against, '--suite', 'unit', '--coverage', '--root', root]));

    expect(answer.files.find((file) => file.file === 'src/total.ts')?.regions?.map(({ name, startLine, endLine, cases }) => [name, startLine, endLine, cases]))
      .toEqual([['applyDiscount', 2, 4, 1], ['round', 6, 8, 0]]);
  });

  it('says what the change might do when the named suite\'s cases were cut at other text than its snapshot', async () => {
    const { root, first, against } = await changed({ suites: ['unit'], tree: LEAD, lines: LEAD_LINES, indexed: AFTER_LINES });
    const answer = await review(parse(['--since', first, '--against', against, '--suite', 'unit', '--root', root]));

    expect(answer.record).toBe('before');
    const markdown = formatReview(answer, 'markdown');
    expect(markdown).toContain('### 🧭 What this change might do');
    expect(markdown).not.toContain('### 🧭 What this change did');
  });

  it('takes the regions of a suite that ran the tree when the named suite\'s cases were cut at other text than its snapshot', async () => {
    const { root, first, against } = await changed({ suites: ['unit', 'browser'], tree: LEAD, lines: LEAD_LINES, indexed: AFTER_LINES });
    await recordTotal(testCoverageFile(root, { suite: 'browser' }), {
      commit: first,
      text: LEAD,
      lines: LEAD_LINES,
      tests: [{ file: 'test/total.test.ts', complete: true, preconditions: [] }],
      entered: { applyDiscount: [], round: ['test/total.test.ts'] },
      index: { tests: [ROUNDS], modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', ...LEAD_LINES.applyDiscount, []), block('round', ...LEAD_LINES.round, [0])] }] },
    });
    const answer = await review(parse(['--since', first, '--against', against, '--suite', 'unit', '--coverage', '--root', root]));

    expect(answer.files.find((file) => file.file === 'src/total.ts')?.regions?.map(({ name, startLine, endLine, cases }) => [name, startLine, endLine, cases]))
      .toEqual([['applyDiscount', 2, 4, 0], ['round', 6, 8, 1]]);
    expect(answer.record).toBe('before');
  });
});
