// compass: variance-authority/runtime/attention
import { readCommitRuns } from '@variance-authority/sense/test-selection';
import type { ParsedReview } from '../review-args.js';
import { coverage } from './coverage.js';
import { review, type Review } from './review.js';
import { eachSuite } from './review-suites.js';
import { namedSuite, ownRecord } from './suite-record.js';

/** Each suite keeps its own denominator and mainline baseline. A review counts what ran, never over which text: that split is `variance coverage`'s. */
export async function reviewWithCoverage(request: ParsedReview): Promise<Review> {
  const answer = await review(request);
  if (request.coverage !== true) return answer;
  const { name } = await namedSuite(request.root, request.suite);
  const readings = await eachSuite(request.root, (suite) => coverage({
    command: 'coverage', root: request.root, format: 'json', packages: true,
    ...(suite === undefined ? {} : { suite }),
    ...(request.against === undefined || suite !== name ? {} : { against: request.against }),
  }, undefined));
  return { ...answer, coverage: readings, ranCommits: await ranCommits(request.root), ...(request.suite === undefined ? {} : { recordedSuite: request.suite }) };
}

/** The commit each suite's runs name. A record seeded from another's (`runs: 0`) lists none, and a suite whose runs cannot be read shows none. */
async function ranCommits(root: string): Promise<readonly string[]> {
  const listed = await eachSuite(root, async (suite) => readCommitRuns(await ownRecord(root, suite)));
  return listed.flatMap((runs) => runs === undefined || 'missed' in runs || runs.runs === 0 || runs.commit === undefined ? [] : [runs.commit]);
}
