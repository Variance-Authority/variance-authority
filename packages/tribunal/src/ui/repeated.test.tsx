import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { Repeats, SubjectView } from '../review.js';
import { createReviewClient } from './client.js';
import { SubjectPanel } from './review.js';

/**
 * The line on a subject page that names an earlier build with the same image.
 *
 * The decision made there leads the line, because it is what changes this one:
 * a rejected image that is back is a known defect, and an approved image that
 * differs from today's baseline means the subject renders two images in turn.
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

function page(view: SubjectView): string {
  return renderToStaticMarkup(
    <SubjectPanel
      client={CLIENT}
      reviewer="marina"
      build="ci-1001"
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
      decision: { decision: 'approved', by: 'anton', at: '2026-06-01T12:00:00.000Z' },
    },
  ],
};

describe('an image an earlier build kept', () => {
  it('says a rejected image is back, with who rejected it and why, as a failure', () => {
    const markup = page(subject({ repeats: REJECTED }));

    expect(markup).toContain('va-failure');
    expect(markup).toContain('This is the image');
    expect(markup).toContain('href="/builds/ci-1000/subjects/story%3Acard"');
    expect(markup).toContain('rejected (anton · ');
    expect(markup).toContain('the toggle lost its focus ring');
  });

  it('says an approved image that differs from the baseline means two images in turn', () => {
    const markup = page(subject({ repeats: APPROVED }));

    expect(markup).toContain('va-warned');
    expect(markup).toContain('approved this image (anton · ');
    expect(markup).toContain('and the baseline has changed since');
    expect(markup).toContain('the render is unstable, or a change was reverted');
  });

  it('says only that it was approved when this render does not differ from the baseline', () => {
    const markup = page(subject({ verdict: 'new', repeats: APPROVED }));

    expect(markup).toContain('approved this image');
    expect(markup).not.toContain('changed since');
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
