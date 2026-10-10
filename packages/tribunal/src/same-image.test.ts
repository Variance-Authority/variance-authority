import { beforeEach, describe, expect, it } from 'vitest';
import type { Digest } from '@variance-authority/core/format';
import type { ObservationRecord, VariationRecord } from '@variance-authority/report';
import type { BuildIngest, ReviewStore } from './review.js';
import { POSTED, image, ingest, openReview, report } from './__fixtures__/review.js';

/**
 * Stories of one component that rendered one image, found from what the store
 * already keeps. The failure that reads as a working page is a group nobody
 * should see: two components that both render an empty box, or a subject with
 * no candidate counted as matching one that has.
 */

const RED = image([255, 0, 0]);
const BLUE = image([0, 0, 255]);

let review: ReviewStore;

beforeEach(async () => {
  ({ review } = await openReview(() => new Date(POSTED)));
});

function observed(subject: string): ObservationRecord {
  return { subject, verdict: 'new', because: 'no baseline yet', changedPixels: 0, regions: [] };
}

/** A build whose subjects rendered the given PNGs; `undefined` pushes no candidate. */
function rendered(
  candidates: Readonly<Record<string, string | undefined>>,
  variations: readonly VariationRecord[] = [],
): BuildIngest {
  const subjects = Object.keys(candidates);
  return ingest({
    report: report({ observations: subjects.map(observed), notObserved: [], variations }),
    images: Object.fromEntries(
      subjects.flatMap((subject) => {
        const bytes = candidates[subject];
        return bytes === undefined
          ? []
          : [[subject, { after: { bytes, documentDigest: subject as Digest, width: 2, height: 2, missingFonts: [] } }]];
      }),
    ),
  });
}

describe('stories of one component that render one image are grouped', () => {
  it('groups the stories whose candidates are the same bytes, and leaves the one that differs out', async () => {
    await review.ingest(
      rendered({
        'story:product-card--control': RED,
        'story:product-card--sale': RED,
        'story:product-card--sold-out': BLUE,
      }),
    );

    const detail = await review.build('ci-1001');

    expect(detail?.sameImage).toEqual([
      { family: 'story:product-card', subjects: ['story:product-card--sale', 'story:product-card--control'] },
    ]);
  });

  it('orders a group along the lattice, so the arm follows what it varies from', async () => {
    await review.ingest(
      rendered(
        { 'story:product-card--control': RED, 'story:product-card--sale': RED },
        [{ subject: 'story:product-card--sale', parent: 'story:product-card--control', how: 'declared', because: 'declared' }],
      ),
    );

    const detail = await review.build('ci-1001');

    expect(detail?.sameImage[0]?.subjects).toEqual(['story:product-card--control', 'story:product-card--sale']);
  });

  it('does not group two components that happen to render the same image', async () => {
    // An empty state and a spinner frame can both be a blank box. That is two
    // components agreeing, not a story that forgot to vary.
    await review.ingest(rendered({ 'story:empty-state--default': RED, 'story:spinner--default': RED }));

    expect((await review.build('ci-1001'))?.sameImage).toEqual([]);
  });

  it('orders members of one length by code unit, so a Worker and Node give one answer', async () => {
    await review.ingest(rendered({ 'story:badge--a': RED, 'story:badge--B': RED }));

    expect((await review.build('ci-1001'))?.sameImage.map((group) => group.subjects)).toEqual([
      ['story:badge--B', 'story:badge--a'],
    ]);
  });

  it('does not count stories with no candidate as matching each other or one that has', async () => {
    await review.ingest(
      rendered({
        'story:product-card--control': RED,
        'story:product-card--sale': undefined,
        'story:product-card--sold-out': undefined,
      }),
    );

    expect((await review.build('ci-1001'))?.sameImage).toEqual([]);
  });

  // A story that settled on its baseline's document digest uploads no candidate,
  // so a pair is named only on a build where both kept one: both new, or both
  // changed. A new arm beside a base that settled is not named. The settled
  // story's picture is its baseline, but the build does not record which one,
  // and the current one may have moved.
  it.todo(
    'groups a story that settled on its baseline with a sibling whose candidate is that image — needs the build to record the baseline each settled story matched',
  );

  it('keeps two groups of one component apart', async () => {
    await review.ingest(
      rendered({
        'story:button--primary': RED,
        'story:button--primary-hover': RED,
        'story:button--secondary': BLUE,
        'story:button--secondary-hover': BLUE,
      }),
    );

    const groups = (await review.build('ci-1001'))?.sameImage.map((group) => group.subjects);

    expect(groups).toEqual([
      ['story:button--primary', 'story:button--primary-hover'],
      ['story:button--secondary', 'story:button--secondary-hover'],
    ]);
  });
});
