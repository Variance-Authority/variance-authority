/**
 * One report, and the build a run would have posted from it.
 *
 * Shared by the files that test [`review.ts`](../review.ts) rather than copied
 * into each, because the point of every one of them is what the store does with
 * *this* report — the same three subjects, the same 86 cause pixels against 511
 * collateral. A second copy that drifted by one pixel would turn an ordering
 * claim into two claims about two reports.
 */

import { PNG } from 'pngjs';
import type { Digest, RenderIdentity } from '@variance-authority/core/format';
import type { RunReport, VariationRecord } from '@variance-authority/report';
import { createReviewStore, type BuildIngest, type ReviewStore } from '../review.js';
import { createMemoryR2, createSqliteD1, type MemoryR2, type SqliteD1 } from '../testing.js';

export const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131.0.0',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

export const CANDIDATE = image([0, 0, 0]);
export const PREVIOUS = image([255, 255, 255]);

export function image(colour: readonly [number, number, number]): string {
  const png = new PNG({ width: 2, height: 2 });
  for (let index = 0; index < png.data.length; index += 4) {
    png.data[index] = colour[0];
    png.data[index + 1] = colour[1];
    png.data[index + 2] = colour[2];
    png.data[index + 3] = 255;
  }
  return PNG.sync.write(png).toString('base64');
}

/**
 * A report as `variance run` writes one: two subjects changed by one edit, where
 * the reflowed container carries six times the pixels of the component that was
 * actually edited.
 */
export function report(overrides: Partial<RunReport> = {}): RunReport {
  return {
    runVersion: 1,
    at: '2026-06-01T10:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    intent: 'tighten the toolbar',
    observations: [
      {
        subject: 'story:todos--populated',
        verdict: 'changed',
        because: 'the rendered image differs from the baseline',
        changedPixels: 1530,
        regions: [
          {
            x: 0, y: 0, width: 10, height: 10, pixels: 86,
            component: 'Toggle', file: 'src/ds/components.tsx', cause: true,
          },
          {
            x: 0, y: 20, width: 40, height: 20, pixels: 511,
            component: 'Stack', file: 'src/ds/components.tsx', cause: false,
          },
        ],
        findings: [],
      },
      {
        subject: 'story:toolbar',
        verdict: 'unchanged',
        because: 'the document digests to what the baseline was painted from',
        changedPixels: 0,
        regions: [],
      },
    ],
    notObserved: [
      { subject: 'story:modal', kind: 'failed', because: 'the renderer crashed on navigation' },
      { subject: 'story:legacy', kind: 'excluded', because: 'excluded by config' },
    ],
    ...overrides,
  };
}

export function ingest(overrides: Partial<BuildIngest> = {}): BuildIngest {
  return {
    build: 'ci-1001',
    commit: 'abc123',
    branch: 'feat/toolbar',
    report: report(),
    images: {
      'story:todos--populated': {
        after: {
          bytes: CANDIDATE,
          documentDigest: 'deadbeef' as Digest,
          width: 2,
          height: 2,
          missingFonts: [],
        },
        before: { bytes: PREVIOUS },
        diff: { bytes: PREVIOUS },
      },
    },
    ...overrides,
  };
}

/**
 * The three states a variation arrives in, in one report.
 *
 * Together they are the distinction the table keeps a nullable column for: an arm
 * that was measured and differs, one that was measured and reaches nothing, and
 * one nothing could measure because the parent it named is not in this run.
 */
export const VARIATIONS: readonly VariationRecord[] = [
  {
    subject: 'story:todos--populated-dark',
    parent: 'story:todos--populated',
    identical: false,
    bands: ['token'],
    components: ['Toggle'],
    digest: 'v1:d2eebe6199661536',
    how: 'named',
    because: '`story:todos--populated-dark` differs from `story:todos--populated` in token',
  },
  {
    subject: 'story:todos--sale',
    parent: 'story:todos--populated',
    identical: true,
    bands: [],
    digest: 'v1:ce4228e7c7dcb46f',
    how: 'declared',
    because: '`story:todos--sale` renders identically to `story:todos--populated`',
  },
  {
    subject: 'story:todos--orphan',
    because: 'the parent this subject declares was not observed in this run',
  },
];

/** The hour a build in these fixtures was posted at. */
export const POSTED = '2026-06-01T12:00:00.000Z';

/**
 * A store over an empty database and an empty bucket.
 *
 * `now` is a getter rather than a date because the tests that reach retention
 * move the clock after the build was written, which is the only way to have a
 * build that is old without waiting for it to become one.
 */
export async function openReview(
  now: () => Date = () => new Date(POSTED),
): Promise<{ db: SqliteD1; bucket: MemoryR2; review: ReviewStore }> {
  const db = await createSqliteD1();
  const bucket = createMemoryR2();
  return { db, bucket, review: createReviewStore({ db, bucket, project: 'todomvc', now }) };
}
