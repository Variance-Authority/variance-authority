import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RegionRecord } from '@variance-authority/report';
import type { SubjectView } from '../review-types.js';
import type { Appearance } from './grouping.js';
import { HandedTo, MovedElsewhere, MovedHere, MovedLead, WhatMoved } from './moved.js';
import { movedElsewhere, senseAcross, senseOfSubject, senses, type Across } from './sense.js';

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

    expect(draw(<MovedLead component="Button" across={across} handed={[]} />)).toContain(
      'what it announces, its layout and its style values',
    );
  });

  it('says a change is collateral when its own hashes never moved', () => {
    const across = senseAcross('Button', [
      appearance({ subject: 'a', regions: [region({ component: 'Button' })], moved: [] }),
    ]);

    expect(draw(<MovedLead component="Button" across={across} handed={[]} />)).toContain(
      'pushed by something else',
    );
  });

  it('says nothing at all when no render here compared hashes', () => {
    const across = senseAcross('Button', [appearance({ subject: 'a' })]);

    expect(draw(<MovedLead component="Button" across={across} handed={[]} />)).toBe('');
  });

  it('leaves a band a parent owns out of the sentence about this component', () => {
    // The complaint this exists for: `button.tsx` restyles a button, a card adds
    // an `aria-label` to the one it mounts, and the lead told a reviewer to look
    // for a renamed control in the button's own file.
    const across = senseAcross('Button', [{ ...appearance({}), subject: SALE }]);
    const handed = [{ band: 'a11y', holders: ['ProductCard'], moved: 6, held: 10 }];

    const html = draw(<MovedLead component="Button" across={across} handed={handed} />);

    expect(html).toContain('its layout and its style values');
    expect(html).not.toContain('what it announces');
  });

  it('keeps *all of it was handed down* apart from *none of it moved*', () => {
    const across = senseAcross('Button', [
      appearance({ subject: 'a', moved: [{ component: 'Button', bands: ['a11y'], cause: true }] }),
    ]);
    const handed = [{ band: 'a11y', holders: ['ProductCard'], moved: 1, held: 3 }];

    expect(draw(<MovedLead component="Button" across={across} handed={handed} />)).toContain(
      'Nothing of <strong>Button</strong>’s own moved',
    );
    expect(draw(<MovedLead component="Button" across={across} handed={[]} />)).toContain(
      'what it announces',
    );
  });
});

describe('the band a parent handed down', () => {
  const go = (): void => {};

  it('names the holder and the partition that found it', () => {
    const html = draw(
      <HandedTo
        handed={[{ band: 'a11y', holders: ['ProductCard'], moved: 6, held: 10 }]}
        build="9"
        changes={new Set(['ProductCard'])}
        go={go}
      />,
    );

    expect(html).toContain('what it announces');
    expect(html).toContain('ProductCard');
    expect(html).toContain('6 renders it draws');
    expect(html).toContain('still in the other 10');
  });

  it('links the holder only when the docket has a page for it', () => {
    const handed = [{ band: 'a11y', holders: ['ProductCard'], moved: 6, held: 10 }];

    expect(
      draw(<HandedTo handed={handed} build="9" changes={new Set()} go={go} />),
    ).not.toContain('href');
    expect(
      draw(<HandedTo handed={handed} build="9" changes={new Set(['ProductCard'])} go={go} />),
    ).toContain('/builds/9/changes/ProductCard');
  });

  it('names both holders when the partition fits two, and draws nothing on none', () => {
    // Naming one of two is a route a reviewer would check and find half of.
    const html = draw(
      <HandedTo
        handed={[{ band: 'a11y', holders: ['CartCard', 'ProductCard'], moved: 4, held: 6 }]}
        build="9"
        changes={new Set()}
        go={go}
      />,
    );

    expect(html).toContain('CartCard');
    expect(html).toContain('ProductCard');
    expect(html).toContain('they draw');
    expect(draw(<HandedTo handed={[]} build="9" changes={new Set()} go={go} />)).toBe('');
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

/**
 * The gap between the two tiers, which is the reviewer's problem and not a
 * presentation detail.
 *
 * A render is filed under the component its leading *region* resolved to, and a
 * change page lists the renders filed under it. So a commit touching a button and
 * the price string in the card around it files every card under whichever drew
 * the larger box — and the button's page is silent about the rest. Approving
 * there decides what is on the page; the silence is renders left open under a
 * name nobody looking for this change would open.
 */
describe('the renders this change moved in that another change owns', () => {
  const here = new Set(['story:product-card--control']);

  const others: readonly SubjectView[] = [
    subject({
      subject: 'story:product-card--sale-dark',
      regions: [region({ component: 'CardFooter' })],
      moved: [{ component: 'Button', bands: ['token'], cause: true }],
    }),
    subject({
      subject: 'route/sneakers@1280',
      regions: [region({ component: 'Shell', cause: false })],
      moved: [{ component: 'Button', bands: ['geometry'], cause: true }],
    }),
    subject({
      subject: 'story:cart-card--item',
      regions: [region({ component: 'Button' })],
      moved: [{ component: 'Button', bands: ['geometry'], cause: false }],
    }),
    subject({
      subject: 'story:product-card--control',
      regions: [region({ component: 'Button' })],
      moved: [{ component: 'Button', bands: ['token'], cause: true }],
    }),
  ];

  it('names them, with the change each one was filed under', () => {
    const found = movedElsewhere('Button', others, here);

    expect(found).toEqual([
      { subject: 'story:product-card--sale-dark', filedUnder: 'CardFooter', drawn: false },
      { subject: 'route/sneakers@1280', drawn: false },
    ]);
  });

  it('leaves out the renders already listed on the page', () => {
    // The caller's list is the definition of *already shown*. Re-deriving it here
    // would be a second opinion about the same question, and the two would drift.
    expect(movedElsewhere('Button', others, new Set()).map((each) => each.subject)).toContain(
      'story:product-card--control',
    );
  });

  it('leaves out a render where the component was only pushed', () => {
    // `cart-card--item` has Button moving with `cause: false`: its box was shoved
    // by somebody else's edit. Listing it would put the collateral this ranking
    // exists to demote back on the page as work.
    expect(movedElsewhere('Button', others, here).map((each) => each.subject)).not.toContain(
      'story:cart-card--item',
    );
  });

  it('says a decision here does not carry to them', () => {
    const html = draw(
      <MovedElsewhere
        component="Button"
        found={movedElsewhere('Button', others, here)}
        build="9"
        go={() => undefined}
      />,
    );

    expect(html).toContain('2 further renders');
    expect(html).toContain('under CardFooter');
    expect(html).toContain('no component named the cause');
    expect(html).toContain('Deciding this change does not decide them.');
  });

  it('draws nothing when every render it moved in is already on the page', () => {
    expect(
      draw(<MovedElsewhere component="Button" found={[]} build="9" go={() => undefined} />),
    ).toBe('');
  });
});

describe('how far a passenger is from the change', () => {
  const beside = (...names: readonly string[]): Across =>
    senseAcross('Button', [
      appearance({
        moved: [
          { component: 'Button', bands: ['token'], cause: true },
          ...names.map((component) => ({ component, bands: ['geometry'] as const, cause: false })),
        ],
        regions: [region({ component: 'Button' })],
      }),
    ]);

  it('puts the distance on the rows the graph places, and on no others', () => {
    const html = draw(
      <WhatMoved
        component="Button"
        across={beside('Card', 'Portal')}
        far={(name) => (name === 'Card' ? { kind: 'importer', hops: 1 } : { kind: 'unreached' })}
      />,
    );

    expect(html).toContain('imports it');
    expect(html.match(/va-moved-far/g)).toHaveLength(1);
  });

  it('says once, at the foot, what it could not place', () => {
    // Not on the rows. Nine rows carrying the same three words is a column a
    // reader stops seeing after the second one, and it reads as a property of
    // each component rather than of the graph.
    const html = draw(
      <WhatMoved
        component="Button"
        across={beside('Card', 'Portal', 'Overlay')}
        far={(name) => (name === 'Card' ? { kind: 'importer', hops: 1 } : { kind: 'unreached' })}
      />,
    );

    expect(html).toContain('arrives at 2 others');
    expect(html).toContain('not something this build measured');
  });

  it('does not call an unplaced list *the others* when it placed none of them', () => {
    const html = draw(
      <WhatMoved component="Button" across={beside('Card')} far={() => ({ kind: 'unreached' })} />,
    );

    expect(html).toContain('arrives at any of these');
  });

  it('holds its tongue entirely when the run carried no diff to walk', () => {
    // `unknown` is the whole page's condition, not a fact about this list, and a
    // list that repeated it would be reporting on the run from inside a component.
    const html = draw(
      <WhatMoved component="Button" across={beside('Card')} far={() => ({ kind: 'unknown' })} />,
    );

    expect(html).not.toContain('va-moved-far');
    expect(html).not.toContain('this build measured');
  });

  it('says nothing per row when the build carried no diff', () => {
    const across = senseAcross('Button', [
      appearance({
        moved: [
          { component: 'Button', bands: ['token'], cause: true },
          { component: 'Card', bands: ['geometry'], cause: false },
        ],
        regions: [region({ component: 'Button' })],
      }),
    ]);

    expect(draw(<WhatMoved component="Button" across={across} far={() => ({ kind: 'unknown' })} />))
      .not.toContain('va-moved-far');
  });
});
