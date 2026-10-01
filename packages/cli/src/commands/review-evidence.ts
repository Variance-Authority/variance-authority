// compass: variance-authority/runtime/attention
import { declaredSuites } from '@variance-authority/sense/test-selection';
import type { ParsedReview } from '../review-args.js';
import { messageOf } from '../config-values.js';
import { OperatorError } from '../exit.js';
import { coverage } from './coverage.js';
import { review, type Review } from './review.js';
import type { ReviewCoverage } from './review-coverage.js';

/** Each suite keeps its own denominator and mainline baseline. */
export async function reviewWithCoverage(request: ParsedReview): Promise<Review> {
  const answer = await review(request);
  if (request.coverage !== true) return answer;
  const suites = declaredSuites(request.root)?.map((suite) => suite.name) ?? [undefined];
  const readings: ReviewCoverage[] = [];
  for (const suite of suites) {
    try {
      readings.push(await coverage({
        command: 'coverage', root: request.root, format: 'json', packages: true,
        ...(suite === undefined ? {} : { suite }),
        ...(request.against === undefined || suite !== request.suite ? {} : { against: request.against }),
      }));
    } catch (error) {
      readings.push({ ...(suite === undefined ? {} : { suite }), missed: messageOf(error), ...(error instanceof OperatorError && error.kind === 'unrecorded' ? { unrecorded: true as const } : {}) });
    }
  }
  return { ...answer, coverage: readings, ...(request.suite === undefined ? {} : { recordedSuite: request.suite }) };
}
