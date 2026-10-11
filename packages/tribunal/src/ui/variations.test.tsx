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

  it('reserves a baseline its own size, which is the one it is drawn at', () => {
    const markup = draw(pair, [
      {
        ...subject('story:product-card--control', { before: true, after: false, diff: false }),
        size: { width: 999, height: 999 },
        baseline: { width: 440, height: 360 },
      },
      subject('story:product-card--sale', { before: false, after: true, diff: false }),
    ]);

    expect(markup).toContain('width="440" height="360"');
    expect(markup).not.toContain('width="999"');
  });

  it('bounds a side nobody measured by the tile, since no scale can place it', () => {
    const markup = draw(pair, [
      subject('story:product-card--control', { before: false, after: true, diff: false }),
      subject('story:product-card--sale', { before: false, after: true, diff: false }),
    ]);

    expect(markup.match(/style="max-width:220px;max-height:180px"/g)).toHaveLength(2);
  });

  it('bounds a side measured as empty by the tile, since no scale can come from it', () => {
    // A recorded size of zero divides the tile by zero, and a width of NaN
    // pixels is dropped, leaving the picture unbounded.
    const markup = draw(pair, [
      { ...subject('story:product-card--control', { before: false, after: true, diff: false }), size: { width: 0, height: 300 } },
      subject('story:product-card--sale', { before: false, after: true, diff: false }),
    ]);

    expect(markup).not.toContain('NaN');
    expect(markup.match(/style="max-width:220px;max-height:180px"/g)).toHaveLength(2);
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
    // The build has no page for a subject it never read.
    expect(markup).not.toContain('href="/builds/ci-1/subjects/story%3Aproduct-card--control"');
  });

  it('names each picture once, by the link that holds it', () => {
    const markup = draw(pair, [
      subject('story:product-card--control', { before: false, after: true, diff: false }),
      subject('story:product-card--sale', { before: false, after: true, diff: false }),
    ]);

    expect(markup).not.toContain('alt="story:');
  });

  it('draws both sides at one magnification, so a size change reads as one', () => {
    // Two pictures each shrunk to fit their own tile differ everywhere, and the
    // pair is read as a comparison. The box holding both is what is scaled.
    const markup = draw(pair, [
      { ...subject('story:product-card--control', { before: false, after: true, diff: false }), size: { width: 400, height: 300 } },
      { ...subject('story:product-card--sale', { before: false, after: true, diff: false }), size: { width: 200, height: 300 } },
    ]);

    expect(markup).toContain('style="width:220px"');
    expect(markup).toContain('style="width:110px"');
    expect(markup).toContain('decoding="async"');
  });

  it('draws a capture too large for the tile at a quarter, cropped to its top-left corner, and says so', () => {
    // A 9000-pixel page fitted to a 180-pixel tile is drawn at a fiftieth, with
    // smoothing refused, and the rows that survive are chosen by the sampler:
    // two sides can then match or differ by sampling alone.
    const tall = { width: 1280, height: 9000 };
    const markup = draw(pair, [
      { ...subject('story:product-card--control', { before: false, after: true, diff: false }), size: tall },
      { ...subject('story:product-card--sale', { before: false, after: true, diff: false }), size: tall },
    ]);

    expect(markup.match(/style="width:320px"/g)).toHaveLength(2);
    expect(markup.match(/class="va-variation-crop"/g)).toHaveLength(2);
    expect(markup.match(/its top-left corner, at quarter size/g)).toHaveLength(2);
  });

  it('draws a capture that fits the tile at a quarter or more whole, with no crop', () => {
    const markup = draw(pair, [
      { ...subject('story:product-card--control', { before: false, after: true, diff: false }), size: { width: 400, height: 300 } },
      subject('story:product-card--sale', { before: false, after: true, diff: false }),
    ]);

    expect(markup).not.toContain('va-variation-crop');
    expect(markup).not.toContain('top-left');
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

describe('a subject varying on two axes is drawn as a grid', () => {
  const step = (axis: string, position: number, from: string, to: string): VariationRecord['step'] => ({ axis, position, from, to });
  const lattice: readonly VariationRecord[] = [
    { subject: 'story:card--sale', parent: 'story:card', how: 'named', step: step('promo', 0, 'none', 'sale'), because: 'differs' },
    { subject: 'story:card--dark', parent: 'story:card', how: 'named', step: step('scheme', 1, 'light', 'dark'), because: 'differs' },
    { subject: 'story:card--sale-dark', parent: 'story:card--sale', how: 'named', step: step('scheme', 1, 'light', 'dark'), because: 'differs' },
  ];
  const all = ['story:card', 'story:card--sale', 'story:card--dark', 'story:card--sale-dark'];

  function drawAll(variations: readonly VariationRecord[], ids: readonly string[]): string {
    return renderToStaticMarkup(
      <Variations
        variations={variations}
        pictures={{
          client,
          build: 'ci-1',
          subjects: ids.map((id) => subject(id, { before: false, after: true, diff: false })),
          go: () => undefined,
        }}
      />,
    );
  }

  it('draws the four renders once each, row by row, with the axis values as headings', () => {
    // A link compares the combination with one neighbour; the grid puts it
    // beside the neighbour on the other axis too.
    const markup = drawAll(lattice, all);
    const at = (id: string): number => markup.indexOf(`/subjects/${encodeURIComponent(id)}/after.png`);

    expect(markup).toContain('<table class="va-variation-grid">');
    expect(at('story:card')).toBeLessThan(at('story:card--dark'));
    expect(at('story:card--dark')).toBeLessThan(at('story:card--sale'));
    expect(at('story:card--sale')).toBeLessThan(at('story:card--sale-dark'));
    for (const id of all) {
      expect(markup.split(`/subjects/${encodeURIComponent(id)}/after.png`)).toHaveLength(2);
    }
    expect(markup).toContain('<th scope="col">dark</th>');
    expect(markup).toContain('<th scope="row">sale</th>');
  });

  it('says which combination nothing in the family is at, and claims no more than that', () => {
    // A subject at that combination linked from elsewhere — a tag naming an
    // unrelated parent — is in the run. The grid only knows its own family.
    const markup = drawAll(lattice.slice(0, 2), all);

    expect(markup).toContain('nothing varying from <code>story:card</code> is <code>promo</code> sale and <code>scheme</code> dark');
  });

  it('keeps what each pair measured, under the grid', () => {
    const markup = drawAll(lattice, all);

    expect(markup.match(/class="va-because"/g)).toHaveLength(3);
  });
});
