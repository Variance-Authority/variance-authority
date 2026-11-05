// compass: variance-authority.review
import type { BuildDetail, BuildSummary, SubjectView } from '../review-types.js';
import type { ReviewClient } from '../ui/client.js';

export function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'story:card',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 1530,
    regions: [
      { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, component: 'Button', fingerprint: 'v1:aaa' },
    ],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...overrides,
  };
}

export function build(id: string, subjects: readonly SubjectView[]): BuildDetail {
  return {
    project: 'snkr-shop',
    build: id,
    commit: `commit${id}0000000`,
    at: '2026-06-01T12:00:00.000Z',
    identity: { renderer: 'playwright-chromium', engine: 'chromium@131' } as never,
    retention: 'durable',
    verdicts: { changed: 1, unchanged: 0, new: 0, ignored: 0 },
    decided: 0,
    pending: 1,
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
    subjects,
    notObserved: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: null,
    causes: [],
    variations: [],
    sameImage: [],
    reach: null,
    journeys: null,
    // Builds 5 and 6 of the example repository, and 6 is the one with a run
    // before it. The page reads this rather than a listing, which is why the
    // client below may refuse `builds` outright.
    previous: id === '6' ? '5' : null,
  };
}

/** A client answering the two calls the build page and its crossing make. */
export function clientThat(
  now: BuildDetail,
  earlier: BuildDetail,
  concerns: ReviewClient['concerns'] = async () => ({ concerns: [], tally: { open: 0, investigating: 0, resolved: 0 } }),
): ReviewClient {
  const refuse = (): never => {
    throw new Error('the build page reads the build list, two builds and its concerns, nothing else');
  };

  return {
    builds: async (): Promise<readonly BuildSummary[]> => [now, earlier],
    build: async (id: string) => (id === earlier.build ? earlier : now),
    changelog: refuse,
    churn: refuse,
    reach: refuse,
    flakiness: refuse,
    lastChanged: refuse,
    decide: refuse,
    sweep: refuse,
    concerns,
    imageUrl: () => '',
  } as unknown as ReviewClient;
}
