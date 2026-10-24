import { readFile, writeFile } from 'node:fs/promises';
import { afterEach, describe, expect, it } from 'vitest';
import {
  caseSectionsAt,
  commitRunsFile,
  encodeExecutionIndex,
  testCoverageFile,
  withCaseSections,
} from '@variance-authority/sense/test-selection';
import { readFlags } from '../args.js';
import { parseReviewArgs } from '../review-args.js';
import { flagsFor, synopsisFor } from '../usage.js';
import { review } from './review.js';
import { formatReview, reviewPieces } from './review-text.js';
import { DISCOUNTS, block, changed } from './review-fixture.js';

function parse(argv: readonly string[]) {
  return parseReviewArgs(readFlags(argv, 'review', flagsFor('review'), synopsisFor('review')));
}

const CHANGE = 'c'.repeat(40);

/**
 * A second run at the change's commit ran `test/total.test.ts` again, so the
 * layer it retired mixes this commit's cases into the ones they replaced and
 * names no commit to diff it from.
 */
async function ranTwice(root: string, retiredAt?: string, ran: readonly string[] = ['test/total.test.ts']): Promise<string> {
  const record = testCoverageFile(root);
  const { index } = caseSectionsAt(record);
  const before = { tests: [DISCOUNTS], modules: [{ file: 'src/total.ts', blocks: [block('applyDiscount', 1, 3, [0])] }] };
  const last = { commit: CHANGE, at: '2026-09-26T00:00:00.000Z', files: ['test/total.test.ts'], cases: [], ...(retiredAt === undefined ? {} : { before: retiredAt }) };
  await writeFile(record, withCaseSections(await readFile(record), {
    ...(index === undefined ? {} : { index }),
    before: encodeExecutionIndex(before),
    last: Buffer.from(JSON.stringify(last)),
  }));
  await writeFile(commitRunsFile(record), JSON.stringify({
    commit: CHANGE, first: '2026-09-26T00:00:00.000Z', latest: '2026-09-26T00:00:00.000Z', runs: 2, files: ran,
  }));
  return record;
}

describe('a review whose cases cannot be compared with the ones the runs replaced', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it('answers in every format, and says why no case is compared', async () => {
    const { root, first } = await changed();
    const record = await ranTwice(root);

    const answer = await review(parse(['--since', first, '--root', root]));

    expect(answer.motion).toMatchObject({ base: { from: record, kind: 'before' }, undiffed: expect.stringMatching(/^The run before the last one names no commit it was recorded at/u) });
    expect(answer.motion?.moved).toBeUndefined();
    expect(answer.files.find((file) => file.file === 'src/total.ts')?.regions?.map((region) => region.name)).toEqual(['applyDiscount', 'round']);
    expect(formatReview(answer, 'text')).toContain(`Not compared: ${answer.motion?.undiffed}`);
    expect(formatReview(answer, 'markdown')).toContain(`No case is compared against the base: ${answer.motion?.undiffed}`);
    const json = JSON.parse([...reviewPieces(answer, 'json')].join('')) as { motion?: { undiffed?: string } };
    expect(json.motion?.undiffed).toBe(answer.motion?.undiffed);
  });

  it('still names the test files no run at this commit wrote a case index for', async () => {
    const { root, first } = await changed({ gone: true });
    await ranTwice(root, undefined, ['test/round.test.ts', 'test/total.test.ts']);

    const answer = await review(parse(['--since', first, '--root', root]));

    expect(answer.motion).toMatchObject({ unwritten: ['test/round.test.ts'], undiffed: expect.stringMatching(/^The run before the last one names no commit/u) });
    expect(formatReview(answer, 'text')).toContain('Not compared, no case index was written at this commit for: test/round.test.ts.');
    expect(formatReview(answer, 'markdown')).toContain('No case index was written at');
  });
});

/** A commit no clone of the fixture holds, as a shallow clone holds none past its tip. */
const ABSENT = 'd'.repeat(40);

describe('a review whose base is named and cannot be read', () => {
  const cwd = process.cwd();
  afterEach(() => process.chdir(cwd));

  it('is refused when the cases the runs replaced were recorded at a commit this clone does not have', async () => {
    const { root, first } = await changed();
    await ranTwice(root, ABSENT);

    const refused = review(parse(['--since', first, '--root', root]));

    await expect(refused).rejects.toMatchObject({ exitCode: 2, message: expect.stringContaining(`was recorded at ${ABSENT}, which this clone does not have`) });
    await expect(refused).rejects.toThrow(`git fetch origin ${ABSENT}`);
  });

  it('is refused when the record `--against` names was recorded at a commit this clone does not have', async () => {
    const { root, first, against } = await changed();
    const { index } = caseSectionsAt(against);
    await writeFile(against, withCaseSections(await readFile(against), {
      ...(index === undefined ? {} : { index }),
      last: Buffer.from(JSON.stringify({ commit: ABSENT, at: '2026-01-01T00:00:00.000Z', files: [], cases: [] })),
    }));

    await expect(review(parse(['--since', first, '--against', against, '--root', root]))).rejects.toMatchObject({
      exitCode: 2,
      message: expect.stringContaining(`The base \`${against}\` was recorded at ${ABSENT}, which this clone does not have`),
    });
  });
});
