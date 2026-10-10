import type { VariationRecord } from '@variance-authority/report';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SubjectView } from '../review.js';
import { createReviewClient } from './client.js';
import { Variations } from './review.js';

const client = createReviewClient({ endpoint: '/api', token: 'unused-in-a-static-render' });

function subject(id: string, has: SubjectView['has']): SubjectView {
  return {
    subject: id,
    verdict: has.after ? 'new' : 'unchanged',
    because: '',
    changedPixels: 0,
    regions: [],
    has,
    approvable: has.after,
    decision: null,
  };
}

const pair: VariationRecord = {
  subject: 'story:product-card--sale',
  parent: 'story:product-card--control',
  identical: false,
  bands: ['token'],
  how: 'named',
  because: 'differs in token',
};

function draw(variation: VariationRecord, subjects: readonly SubjectView[]): string {
  return renderToStaticMarkup(
    <Variations
      variations={[variation]}
      pictures={{ client, build: 'ci-1', subjects, go: () => undefined }}
    />,
  );
}

describe('a variation is shown as its two pictures', () => {
  it('draws the parent and the arm side by side, each linked to its own page', () => {
    // A flag's effect is visible only with the two renders next to each other,
    // and a list of names asks the reviewer to open two pages to see it.
    const markup = draw(pair, [
      subject('story:product-card--control', { before: false, after: true, diff: false }),
      subject('story:product-card--sale', { before: false, after: true, diff: false }),
    ]);

    const parent = markup.indexOf('/subjects/story%3Aproduct-card--control/after.png');
    const arm = markup.indexOf('/subjects/story%3Aproduct-card--sale/after.png');
    expect(parent).toBeGreaterThan(-1);
    expect(arm).toBeGreaterThan(parent);
    expect(markup).toContain('href="/builds/ci-1/subjects/story%3Aproduct-card--sale"');
  });

  it('draws the baseline when the run kept no candidate, and says which one it is', () => {
    const markup = draw(pair, [
      subject('story:product-card--control', { before: true, after: false, diff: false }),
      subject('story:product-card--sale', { before: false, after: true, diff: false }),
    ]);

    expect(markup).toContain('/subjects/story%3Aproduct-card--control/before.png');
    expect(markup).toContain('<span class="va-how">baseline</span>');
  });

  it('says the run kept no picture rather than drawing an empty frame', () => {
    // Two `unchanged` subjects keep nothing. A blank tile would read as a
    // render that came out blank, which is a different finding.
    const markup = draw({ ...pair, identical: true, bands: [] }, [
      subject('story:product-card--control', { before: false, after: false, diff: false }),
      subject('story:product-card--sale', { before: false, after: false, diff: false }),
    ]);

    expect(markup).not.toContain('<img');
    expect(markup).toContain('no image kept');
  });

  it('says a subject the run never read is not in it, rather than that it kept nothing', () => {
    // A subject the run has no row for was not read; one with a row and no
    // image was read and matched. The two are different findings.
    const markup = draw(pair, [
      subject('story:product-card--sale', { before: false, after: true, diff: false }),
    ]);

    expect(markup).toContain('not in this run');
    expect(markup.match(/no image kept/g) ?? []).toHaveLength(0);
  });

  it('names each picture once, by the link that holds it', () => {
    const markup = draw(pair, [
      subject('story:product-card--control', { before: false, after: true, diff: false }),
      subject('story:product-card--sale', { before: false, after: true, diff: false }),
    ]);

    expect(markup).not.toContain('alt="story:');
  });

  it('draws one picture for a variation whose parent is not in this run', () => {
    const markup = draw(
      {
        subject: 'story:product-card--orphan',
        because: 'the parent this subject declares was not observed in this run',
      },
      [subject('story:product-card--orphan', { before: false, after: true, diff: false })],
    );

    expect(markup.match(/<img/g)).toHaveLength(1);
  });

  it('draws no pictures when it is handed none', () => {
    expect(renderToStaticMarkup(<Variations variations={[pair]} />)).not.toContain('<img');
  });
});
