import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Repeats, SubjectView } from '../review.js';
import { createReviewClient } from './client.js';
import { SubjectPanel } from './review.js';

/**
 * The line on a subject page that names an earlier build with the same image.
 *
 * The decision made there leads the line, because it is what changes this one:
 * a rejected image that is back is a known defect, and an image approved before
 * this build ran that still differs from the baseline is worth a second look.
 */

const CLIENT = createReviewClient({ endpoint: '/api', token: 'unused-in-a-static-render' });

function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'story:card',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 1530,
    regions: [],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...overrides,
  };
}

/** When build ci-1001, the one on screen, ran. */
const RAN = '2026-06-01T10:00:00.000Z';

function page(view: SubjectView): string {
  return renderToStaticMarkup(
    <SubjectPanel
      client={CLIENT}
      reviewer="marina"
      build="ci-1001"
      ran={RAN}
      subject={view}
      go={() => undefined}
      onDecided={() => undefined}
    />,
  );
}

const REJECTED: Repeats = {
  count: 1,
  builds: [
    {
      build: 'ci-1000',
      at: '2026-06-01T09:00:00.000Z',
      decision: {
        decision: 'rejected',
        by: 'anton',
        at: '2026-06-01T12:00:00.000Z',
        note: 'the toggle lost its focus ring',
      },
    },
  ],
};

const APPROVED: Repeats = {
  count: 1,
  builds: [
    {
      build: 'ci-1000',
      at: '2026-06-01T09:00:00.000Z',
      decision: { decision: 'approved', by: 'anton', at: '2026-06-01T09:30:00.000Z' },
    },
  ],
};

describe('an image an earlier build kept', () => {
  it('says a rejected image is back, with who rejected it and why', () => {
    const markup = page(subject({ repeats: REJECTED }));

    expect(markup).toContain('va-rejected');
    expect(markup).toContain('This is the image');
    expect(markup).toContain('href="/builds/ci-1000/subjects/story%3Acard"');
    expect(markup).toContain('rejected (anton · ');
    expect(markup).toContain('the toggle lost its focus ring');
  });

  it('warns that an image approved before this build ran still differs from the baseline', () => {
    const markup = page(subject({ repeats: APPROVED }));

    expect(markup).toContain('va-warned');
    expect(markup).toContain('approved this image (anton · ');
    expect(markup).toContain('before this build ran, and this build still differs from its baseline');
  });

  it('warns as well when this render cannot be compared with the baseline', () => {
    const markup = page(subject({ verdict: 'incomparable', repeats: APPROVED }));

    expect(markup).toContain('va-warned');
  });

  it('says only that it was approved when the approval came after this build ran', () => {
    // This build was compared before anybody approved the image, against the
    // baseline the approval then replaced: its difference says nothing new.
    const lead = APPROVED.builds[0]!;
    const later = { ...lead, decision: { ...lead.decision!, at: '2026-06-01T11:00:00.000Z' } };
    const markup = page(subject({ repeats: { count: 1, builds: [later] } }));

    expect(markup).toContain('approved this image');
    expect(markup).not.toContain('still differs');
    expect(markup).not.toContain('va-warned');
  });

  it('says only that it was approved when this render does not differ from the baseline', () => {
    const markup = page(subject({ verdict: 'unchanged', repeats: APPROVED }));

    expect(markup).toContain('approved this image');
    expect(markup).not.toContain('still differs');
  });

  it('says an earlier build kept it without a decision', () => {
    const markup = page(
      subject({
        repeats: { count: 1, builds: [{ build: 'ci-1000', at: '2026-06-01T09:00:00.000Z', decision: null }] },
      }),
    );

    expect(markup).toContain('kept this image too, and has no decision');
  });

  it('counts the other earlier builds, named or not', () => {
    const markup = page(subject({ repeats: { ...REJECTED, count: 11 } }));

    expect(markup).toContain('10 other earlier builds kept it too');
  });

  it('says nothing for an image no earlier build kept, or a subject that kept none', () => {
    expect(page(subject({ repeats: { count: 0, builds: [] } }))).not.toContain('this image');
    expect(page(subject())).not.toContain('this image');
  });
});
