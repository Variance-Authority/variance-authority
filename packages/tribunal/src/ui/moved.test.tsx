import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RegionRecord } from '@variance-authority/report';
import type { SubjectView } from '../review-types.js';
import type { Appearance } from './grouping.js';
import { MovedHere, MovedLead, WhatMoved } from './moved.js';
import { senseAcross, senseOfSubject, senses } from './sense.js';

/**
 * The semantic tier, held to the two ways a page built on it goes wrong.
 *
 * It can say *nothing moved* about a subject nothing looked at — the failure the
 * whole absent-is-not-empty rule exists for, and the one that reads most like
 * competence: a confident empty list is indistinguishable from a correct one.
 *
 * And it can hand a reviewer somebody else's edit under this component's name.
 * The regions rank by area, so the box that resolves to a name is routinely the
 * box a *neighbour* pushed, and the change page inherits that name. Every
 * assertion about `cause`, `pushed` and `alongside` below is that failure.
 */

function region(overrides: Partial<RegionRecord> = {}): RegionRecord {
  return { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, ...overrides };
}

function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'story:product-card--sale',
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

function appearance(over: Partial<SubjectView>): Appearance {
  return { subject: subject(over), pixels: 100, alongside: [] };
}

/** The example's own shape: a restyled, resized button inside a card whose price moved. */
const SALE = subject({
  regions: [region({ component: 'CardFooter' }), region({ component: 'Anonymous', cause: false })],
  moved: [
    { component: 'Button', bands: ['a11y', 'geometry', 'token'], cause: true },
    { component: 'CardFooter', bands: ['a11y', 'content', 'geometry', 'token'], cause: true },
    { component: 'Anonymous', bands: ['geometry'], cause: false },
  ],
});

describe('the bands, in the words a reviewer reads', () => {
  it('joins them into one clause rather than a column of slugs', () => {
    expect(senses(['geometry', 'token'])).toBe('its layout and its style values');
    expect(senses(['content'])).toBe('its text');
    expect(senses([])).toBe('');
  });

  it('prints a band this build has never heard of instead of dropping it', () => {
    // A newer report is allowed to carry one. A filter over the known list would
    // show four bands where the run recorded five, silently.
    expect(senses(['token', 'motion'])).toBe('its style values and motion');
  });
});

describe('one render, with the hashes and the regions read against each other', () => {
  it('separates what was edited from what a region merely named', () => {
    const sense = senseOfSubject(SALE);

    expect(sense.measured).toBe(true);
    expect(sense.missed.map((each) => each.component)).toEqual(['Button']);
    expect(sense.moved.find((each) => each.component === 'Anonymous')?.cause).toBe(false);
  });

  it('reports a region’s component that its own hashes say held still', () => {
    // Collateral wearing a name. The page must not call it a change: the largest
    // differing area resolved here, and the edit is elsewhere.
    const sense = senseOfSubject(
      subject({ regions: [region({ component: 'Card' })], moved: [] }),
    );

    expect(sense.pushed).toEqual(['Card']);
    expect(sense.moved).toEqual([]);
  });

  it('collapses to unmeasured rather than to nothing-moved', () => {
    const sense = senseOfSubject(subject({ regions: [region({ component: 'Card' })] }));

    expect(sense.measured).toBe(false);
    // Without the hashes every named region would land in `pushed`, and the page
    // would report the whole build as collateral on the strength of no reading.
    expect(sense.pushed).toEqual([]);
  });
});

describe('one change, folded over the renders it appeared in', () => {
  it('unions the bands, because an edit lands differently in different renders', () => {
    const across = senseAcross('Button', [
      appearance({ subject: 'a', moved: [{ component: 'Button', bands: ['token'], cause: true }] }),
      appearance({
        subject: 'b',
        moved: [{ component: 'Button', bands: ['token', 'geometry'], cause: true }],
      }),
    ]);

    // Loudest first, and geometry survives: an intersection would report a size
    // change as a repaint.
    expect(across.bands).toEqual(['geometry', 'token']);
    expect(across.measured).toBe(2);
  });

  it('names the renders whose picture lost this component', () => {
    const across = senseAcross('Button', [{ ...appearance({}), subject: SALE }]);

    expect(across.missedIn).toEqual(['story:product-card--sale']);
  });

  it('names what moved beside it, in its own sense', () => {
    // The complaint this exists for: the text moved in the parent and the style
    // moved in the button, and one page has to show both or the reviewer
    // approves a content edit under a component that does not own content.
    const across = senseAcross('Button', [{ ...appearance({}), subject: SALE }]);

    expect(across.alongside).toEqual([
      { component: 'Anonymous', bands: ['geometry'] },
      { component: 'CardFooter', bands: ['a11y', 'geometry', 'token', 'content'] },
    ]);
  });

  it('counts the renders nothing was read in separately from the ones that held', () => {
    const across = senseAcross('Button', [
      appearance({ subject: 'old' }),
      appearance({ subject: 'new', moved: [] }),
    ]);

    expect(across.unmeasured).toEqual(['old']);
    expect(across.measured).toBe(1);
    expect(across.bands).toEqual([]);
  });
});

function draw(element: ReactElement | null): string {
  return element === null ? '' : renderToStaticMarkup(element);
}

describe('the lead sentence, which is what the page was missing', () => {
  it('says what moved before anything about how much of it did', () => {
    const across = senseAcross('Button', [{ ...appearance({}), subject: SALE }]);

    expect(draw(<MovedLead component="Button" across={across} />)).toContain(
      'what it announces, its layout and its style values',
    );
  });

  it('says a change is collateral when its own hashes never moved', () => {
    const across = senseAcross('Button', [
      appearance({ subject: 'a', regions: [region({ component: 'Button' })], moved: [] }),
    ]);

    expect(draw(<MovedLead component="Button" across={across} />)).toContain(
      'pushed by something else',
    );
  });

  it('says nothing at all when no render here compared hashes', () => {
    const across = senseAcross('Button', [appearance({ subject: 'a' })]);

    expect(draw(<MovedLead component="Button" across={across} />)).toBe('');
  });
});

describe('what moved with it', () => {
  it('reports the renders where the picture is not a picture of this', () => {
    const across = senseAcross('Button', [{ ...appearance({}), subject: SALE }]);
    const html = draw(<WhatMoved component="Button" across={across} />);

    expect(html).toContain('no region carries');
    expect(html).toContain('CardFooter');
    expect(html).toContain('story:product-card--sale');
  });

  it('draws nothing when there is nothing exceptional to say', () => {
    // A heading over a sentence saying everything was ordinary teaches a reader
    // to skip the place the exceptions appear.
    const across = senseAcross('Button', [
      appearance({ subject: 'a', regions: [region({ component: 'Button' })], moved: [{ component: 'Button', bands: ['token'], cause: true }] }),
    ]);

    expect(draw(<WhatMoved component="Button" across={across} />)).toBe('');
  });
});

describe('the render’s own card', () => {
  it('marks the component the picture never found', () => {
    const html = draw(<MovedHere subject={SALE} />);

    expect(html).toContain('no region');
    expect(html).toContain('va-moved-passenger');
  });

  it('distinguishes a baseline with no hashes from a subject that held still', () => {
    expect(draw(<MovedHere subject={subject()} />)).toContain('carrying no component hashes');
    expect(draw(<MovedHere subject={subject({ moved: [] })} />)).toContain('every component hash matched');
  });

  it('says which names a region carried while their hashes held', () => {
    const html = draw(
      <MovedHere
        subject={subject({
          regions: [region({ component: 'Card' })],
          moved: [{ component: 'Button', bands: ['token'], cause: true }],
        })}
      />,
    );

    expect(html).toContain('A region names Card');
    expect(html).toContain('not edited');
  });
});
