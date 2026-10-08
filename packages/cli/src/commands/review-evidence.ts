// compass: variance-authority/runtime/attention
import type { ParsedReview } from '../review-args.js';
import { coverage } from './coverage.js';
import { review, type Review } from './review.js';
import { eachSuite } from './review-suites.js';

/** Each suite keeps its own denominator and mainline baseline. */
export async function reviewWithCoverage(request: ParsedReview): Promise<Review> {
  const answer = await review(request);
  if (request.coverage !== true) return answer;
  const readings = await eachSuite(request.root, (suite) => coverage({
    command: 'coverage', root: request.root, format: 'json', packages: true,
    ...(suite === undefined ? {} : { suite }),
    ...(request.against === undefined || suite !== request.suite ? {} : { against: request.against }),
  }));
  return { ...answer, coverage: readings, ...(request.suite === undefined ? {} : { recordedSuite: request.suite }) };
}
