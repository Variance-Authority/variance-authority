import { describe, expect, it } from 'vitest';
import type { BuildDetail, Placement } from '../review-types.js';
import { heldBy } from './holding.js';

/**
 * The walk that answers *why did this move* for a component the diff cannot name.
 *
 * Every failure here is the same failure with a different name on it: an answer
 * that sounds like a reason and is not one. The census is folded over the whole
 * suite, so a walk that ignores where the component actually moved will reach the
 * cart page from a product card and say the cart drew it. A walk that stops at
 * the first enclosure will name `Card`, which is true and explains nothing,
 * because nothing in the commit reaches `Card` either. And a walk with no answer
 * has four different silences to keep apart — no census, no row, nothing draws
 * it, nothing reached — and printing them as one would put *we did not look* and
 * *we looked and found none* on the same line.
 */

/** The example's own graph, which is where each of these cases came from. */
const CENSUS: readonly Placement[] = [
  place('ProductCard', ['route/sneakers@1280', 'story:product-card--sale'], {
    within: ['Anonymous'],
    renders: ['Card'],
  }),
  place('CartCard', ['route/cart@1280', 'story:cart-card--item'], {
    within: ['Anonymous'],
    renders: ['Card'],
  }),
  place(
    'Card',
    ['route/cart@1280', 'route/sneakers@1280', 'story:cart-card--item', 'story:product-card--sale'],
    { within: ['Anonymous', 'CartCard', 'ProductCard'], renders: ['CardFooter'] },
  ),
  place('CardFooter', ['route/sneakers@1280', 'story:product-card--sale'], { within: ['Card'] }),
  place('Anonymous', ['route/cart@1280', 'route/sneakers@1280'], { renders: ['Card'] }),
  place('MainNav', ['route/sneakers@1280'], { within: ['Anonymous'], renders: ['LinkComponent'] }),
  place('NavItem', ['route/sneakers@1280'], { within: ['MainNav'], renders: ['LinkComponent'] }),
  place('LinkComponent', ['route/sneakers@1280'], { within: ['MainNav', 'NavItem'] }),
];

function place(
  component: string,
  subjects: readonly string[],
  over: Partial<Placement> = {},
): Placement {
  return { component, subjects, within: [], createdBy: [], renders: [], ...over };
}

function build(over: Partial<BuildDetail> = {}): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '9',
    commit: 'a'.repeat(40),
    at: '2026-08-30T00:00:00.000Z',
    identity: { engine: 'chromium' } as BuildDetail['identity'],
    retention: 'durable',
    verdicts: { changed: 1 } as BuildDetail['verdicts'],
    decided: 0,
    pending: 1,
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
    subjects: [],
    notObserved: [],
    causes: [],
    variations: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: CENSUS,
    reach: {
      against: 'main',
      changed: [
        'app/src/components/MainNav.tsx',
        'app/src/components/ProductCard.tsx',
        'app/src/components/ui/button.tsx',
      ],
      components: [
        // `CartCard` is reached too, through the button it also draws. That is
        // what makes the subject constraint below load-bearing rather than
        // decorative: the wrong answer is available and reached.
        { component: 'CartCard', trail: ['app/src/components/ui/button.tsx', 'CartCard'] },
        { component: 'MainNav', trail: ['app/src/components/MainNav.tsx', 'MainNav'] },
        { component: 'NavItem', trail: ['app/src/components/MainNav.tsx', 'NavItem'] },
        { component: 'ProductCard', trail: ['app/src/components/ProductCard.tsx', 'ProductCard'] },
      ],
    },
    ...over,
  };
}

describe('what drew a component the commit declares nowhere', () => {
  it('climbs past an enclosure nothing reaches to the one the commit changed', () => {
    // `Card` draws `CardFooter` and is the wrong answer: the commit does not
    // reach `Card` either, so stopping there restates the question one rung up.
    const holding = heldBy(build())('CardFooter', [
      'route/sneakers@1280',
      'story:product-card--sale',
    ]);

    expect(holding).toEqual({
      kind: 'through',
      by: [{ holder: 'ProductCard', through: ['Card'] }],
    });
  });

  it('refuses a holder that encloses it nowhere the movement happened', () => {
    // The census is suite-wide: `CartCard` draws a `Card` and `Card` draws a
    // `CardFooter`, so an unconstrained walk hands a reviewer the cart as the
    // reason a product page moved. It is reached by the commit, which makes it
    // the most plausible wrong answer available.
    const holding = heldBy(build())('CardFooter', ['story:product-card--sale']);

    expect(holding).toEqual({
      kind: 'through',
      by: [{ holder: 'ProductCard', through: ['Card'] }],
    });
  });

  it('names every holder at the depth it stops at, not the first one', () => {
    // `next/link` is mounted by the nav and by each of its items. Naming one is
    // a route a reviewer would check and find half of.
    const holding = heldBy(build())('LinkComponent', ['route/sneakers@1280']);

    expect(holding).toEqual({
      kind: 'through',
      by: [
        { holder: 'MainNav', through: [] },
        { holder: 'NavItem', through: [] },
      ],
    });
  });

  it('walks the whole suite when nothing said where it moved', () => {
    // Absent is not empty. No subjects is *nobody recorded where*, and reading
    // it as a filter would exclude every rung and report a component with an
    // obvious parent as one nothing in the commit encloses. The answer widens to
    // both cards, which is the honest consequence of not being told where.
    expect(heldBy(build())('CardFooter', [])).toEqual({
      kind: 'through',
      by: [
        { holder: 'CartCard', through: ['Card'] },
        { holder: 'ProductCard', through: ['Card'] },
      ],
    });
  });

  it('says what encloses it when the commit reaches none of them', () => {
    const holding = heldBy(build({ reach: { against: 'main', changed: ['x.css'], components: [] } }))(
      'CardFooter',
      ['story:product-card--sale'],
    );

    expect(holding).toEqual({ kind: 'enclosed', within: ['Card'] });
  });

  it('keeps *no diff was read* apart from *the commit reaches none of them*', () => {
    // With no graph, every component in the suite is enclosed by nothing
    // reached, and a page that said so would turn one missing input into an
    // alarm on every row.
    expect(heldBy(build({ reach: null }))('CardFooter', [])).toEqual({
      kind: 'unmeasured',
      within: ['Card'],
    });
  });

  it('takes a refusal to attribute the diff as no graph, not as an empty one', () => {
    const refused = build({
      reach: { against: 'main', changed: [], components: [], whole: 'no merge base' },
    });

    expect(heldBy(refused)('CardFooter', [])).toEqual({ kind: 'unmeasured', within: ['Card'] });
  });

  it('says nothing draws it rather than reporting it unexplained', () => {
    expect(heldBy(build())('Anonymous', ['route/cart@1280'])).toEqual({ kind: 'outermost' });
  });

  it('separates a name the census never carried from one it placed nowhere', () => {
    expect(heldBy(build())('Ghost', [])).toEqual({ kind: 'unlisted' });
    expect(heldBy(build({ composition: null }))('CardFooter', [])).toEqual({ kind: 'unrecorded' });
  });

  it('terminates on a cycle, which a render tree folded over a suite can contain', () => {
    // `within` is every enclosure anywhere, so a component that appears inside
    // itself in some render — a menu inside a submenu — closes the loop.
    const looped = build({
      composition: [
        place('Menu', ['route/sneakers@1280'], { within: ['Item'] }),
        place('Item', ['route/sneakers@1280'], { within: ['Menu'] }),
      ],
    });

    expect(heldBy(looped)('Menu', [])).toEqual({ kind: 'enclosed', within: ['Item'] });
  });

  it('reports one holder once when two rungs below both name it', () => {
    // `Panel` is drawn by `Left` and by `Right`, and both are drawn by
    // `ProductCard`. Queued twice, it is printed twice under one name.
    const diamond = build({
      composition: [
        place('Panel', ['route/sneakers@1280'], { within: ['Left', 'Right'] }),
        place('Left', ['route/sneakers@1280'], { within: ['ProductCard'] }),
        place('Right', ['route/sneakers@1280'], { within: ['ProductCard'] }),
        place('ProductCard', ['route/sneakers@1280'], { within: [] }),
      ],
    });

    expect(heldBy(diamond)('Panel', [])).toEqual({
      kind: 'through',
      by: [{ holder: 'ProductCard', through: ['Left'] }],
    });
  });
});
