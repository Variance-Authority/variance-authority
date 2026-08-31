import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RegionRecord } from '@variance-authority/report';
import type { BuildDetail, MovementView, ReachView, SubjectView } from '../review-types.js';
import { attributionsOf, rungAcross } from './attribution.js';
import { Because } from './because.js';
import { Arrival } from './change-story.js';
import { originsOf, sourceOf, type Origin } from './grouping.js';
import { laneOf } from './order.js';

/**
 * The run's own conclusion, from the store to the sentence on the page.
 *
 * This vertical existed in the report and stopped at the ingest. The run walked
 * the diff, climbed the enclosure graph, and wrote *`ProductCard` was edited and
 * reaches it through `Card`* — and the page, which never received it, rebuilt a
 * weaker version of the same walk and told the reviewer *no rung above holds
 * this*. Every case here is about that gap staying closed, and about the two ways
 * closing it can go wrong: attributing a render to a reason that belongs to a
 * different render, and turning *nothing is on record* into a finding.
 */

function region(over: Partial<RegionRecord> = {}): RegionRecord {
  return { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, ...over };
}

function subject(name: string, component: string, over: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: name,
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 900,
    regions: [region({ component, pixels: 900, fingerprint: 'v1:a' })],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...over,
  };
}

function movement(over: Partial<MovementView> = {}): MovementView {
  return {
    subject: 'story:product-card--sale',
    component: 'CardFooter',
    cause: 'upstream',
    because:
      '`ProductCard` was edited and reaches it through `Card`; nothing edited its own file, ' +
      'so it moved on what it was given',
    bands: ['geometry'],
    held: [],
    upstream: 'ProductCard',
    through: ['Card'],
    ...over,
  };
}

/** A diff that reaches `ProductCard` and nothing called `CardFooter`. */
const REACH: ReachView = {
  against: 'HEAD~1',
  changed: ['app/src/components/ProductCard.tsx'],
  components: [
    { component: 'ProductCard', trail: ['app/src/components/ProductCard.tsx', 'ProductCard'] },
  ],
  subjects: {
    'story:product-card--sale': { reached: true, through: ['ProductCard'], because: 'edited' },
    'story:cart-card--item': { reached: true, through: ['ProductCard'], because: 'edited' },
  },
};

function build(
  subjects: readonly SubjectView[],
  movements: readonly MovementView[],
  reach: ReachView | null = REACH,
): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '9',
    commit: 'a'.repeat(40),
    at: '2026-08-30T00:00:00.000Z',
    identity: { browser: 'chromium', viewport: { width: 1280, height: 800 } } as never,
    retention: 'durable',
    verdicts: { changed: subjects.length, unchanged: 0, new: 0, incomparable: 0, unstable: 0, ignored: 0 },
    decided: 0,
    pending: subjects.length,
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
    subjects,
    notObserved: [],
    causes: [],
    variations: [],
    declarations: { ignores: null, sensitivities: null },
    composition: null,
    movements,
    reach,
  };
}

function originOf(detail: BuildDetail, component: string): Origin {
  const found = originsOf(detail).origins.find((each) => each.component === component);
  if (found === undefined) throw new Error(`no origin for ${component}`);
  return found;
}

describe('a movement is about a pair, and the index keeps it that way', () => {
  it('answers per render, so one component can move for two reasons', () => {
    // The failure this prevents is silent and order-dependent: keyed by
    // component, the second row overwrites the first and whichever render the
    // reviewer opens is told the other one's story.
    const detail = build(
      [subject('story:a', 'Button'), subject('story:b', 'Button')],
      [
        movement({ subject: 'story:a', component: 'Button', cause: 'edited', file: 'ui/button.tsx' }),
        movement({ subject: 'story:b', component: 'Button' }),
      ],
    );
    const index = attributionsOf(detail);

    expect(index.at('Button', 'story:a')?.cause).toBe('edited');
    expect(index.at('Button', 'story:b')?.cause).toBe('upstream');
    expect(index.about('Button')).toHaveLength(2);
  });

  it('keeps a name apart from another name the join could run into', () => {
    // The two halves are pasted together to make a key, so a separator either
    // half can contain is a collision waiting for a subject called `Card a`.
    const detail = build(
      [subject('story:x', 'Card')],
      [
        movement({ component: 'Card', subject: 'a story' }),
        movement({ component: 'Card a', subject: 'story' }),
      ],
    );
    const index = attributionsOf(detail);

    expect(index.at('Card', 'a story')?.component).toBe('Card');
    expect(index.at('Card a', 'story')?.component).toBe('Card a');
  });

  it('takes the strongest rung when the renders disagree', () => {
    // A component edited in one render and reached from above in another was
    // edited. Folding the other way would file a change under a consequence of
    // itself.
    expect(rungAcross([movement({ cause: 'upstream' }), movement({ cause: 'edited' })])).toBe(
      'edited',
    );
    expect(rungAcross([movement({ cause: 'unexplained' }), movement({ cause: 'token' })])).toBe(
      'token',
    );
  });

  it('answers nothing rather than a sixth rung when nothing is on record', () => {
    expect(rungAcross([])).toBeUndefined();
  });
});

describe('the band a change is read under', () => {
  const footer = subject('story:product-card--sale', 'CardFooter');

  it('files a component an edited parent draws under the parent, not under a shrug', () => {
    // The case the user is looking at. `CardFooter` is not in the diff and never
    // will be — the import walk climbs — and the old docket had one band for
    // this and for a genuine orphan out of a dependency.
    const origin = originOf(build([footer], [movement()]), 'CardFooter');

    expect(origin.cause).toBe('upstream');
    expect(laneOf(origin)).toBe('upstream');
  });

  it('does not turn a missing record into a finding', () => {
    // A build ingested before attributions were carried has no rows at all, and
    // a docket that read that as `unexplained` would open every such build with
    // its loudest band full.
    const origin = originOf(build([footer], []), 'CardFooter');

    expect(origin.cause).toBeUndefined();
    expect(laneOf(origin)).toBe('unnamed');
  });

  it('keeps a component that disagreed with itself out of the band for shrugs', () => {
    // `contradicted` is an answer: the same props rendered more than one way at
    // one commit. The band it used to share says *three records were asked and
    // none of them arrive here*, which is the opposite of what the run found.
    const origin = originOf(
      build([footer], [movement({ cause: 'contradicted', upstream: undefined, through: undefined })]),
      'CardFooter',
    );

    expect(laneOf(origin)).toBe('contradicted');
  });

  it('gives the run’s own failure to explain a band of its own', () => {
    const origin = originOf(
      build([footer], [movement({ cause: 'unexplained', upstream: undefined })]),
      'CardFooter',
    );

    expect(laneOf(origin)).toBe('unexplained');
  });

  it('leaves a component the commit reaches under the work you asked for', () => {
    // `reached` is the stronger claim and comes first: the file graph arrives at
    // this name, which is not something the ladder can contradict by putting it
    // on a lower rung in one render.
    const detail = build([subject('story:product-card--sale', 'ProductCard')], [
      movement({ component: 'ProductCard', cause: 'upstream' }),
    ]);

    expect(laneOf(originOf(detail, 'ProductCard'))).toBe('reached');
  });

  it('keeps a run that read no diff out of every band that assumes one', () => {
    const origin = originOf(build([footer], [movement()], null), 'CardFooter');

    expect(laneOf(origin)).toBe('unread');
  });
});

describe('the row names what the run named', () => {
  const footer = subject('story:product-card--sale', 'CardFooter');

  it('names the parent that handed it the change, and the chain to it', () => {
    // The band over this row used to read *a component the commit did edit draws
    // each one and hands it what it renders* — one paragraph, identical on every
    // build, above a record that held the word `ProductCard` the whole time.
    expect(sourceOf(originOf(build([footer], [movement()]), 'CardFooter'))).toEqual([
      'ProductCard → Card',
    ]);
  });

  it('names both parents when the same component was handed a change by two', () => {
    // The reason this folds over the appearances rather than reading the first.
    // A row that named `CartCard` here would be sending a reviewer to the cart
    // page to look for an edit that landed on the product page as well.
    const detail = build(
      [footer, subject('story:cart-card--item', 'CardFooter')],
      [
        movement(),
        movement({ subject: 'story:cart-card--item', upstream: 'CartCard', through: ['Card'] }),
      ],
    );

    expect(sourceOf(originOf(detail, 'CardFooter'))).toEqual([
      'CartCard → Card',
      'ProductCard → Card',
    ]);
  });

  it('drops the chain when the parent draws it directly', () => {
    const detail = build([footer], [movement({ upstream: 'ProductCard', through: undefined })]);

    expect(sourceOf(originOf(detail, 'CardFooter'))).toEqual(['ProductCard']);
  });

  it('names the file on the rung that has one, which was in a hover attribute', () => {
    const detail = build(
      [footer],
      [movement({ cause: 'edited', file: 'app/src/components/ui/card.tsx', upstream: undefined })],
    );

    expect(sourceOf(originOf(detail, 'CardFooter'))).toEqual(['app/src/components/ui/card.tsx']);
  });

  it('names the properties that took new values on the token rung', () => {
    const detail = build(
      [footer],
      [movement({ cause: 'token', tokens: ['--brand-600', '--radius-lg'], upstream: undefined })],
    );

    expect(sourceOf(originOf(detail, 'CardFooter'))).toEqual(['--brand-600', '--radius-lg']);
  });

  it('falls back to where the docket says it is declared when nothing was recorded', () => {
    const detail = {
      ...build([footer], []),
      causes: [
        {
          component: 'CardFooter',
          file: 'app/src/components/ui/card.tsx',
          subjects: ['story:product-card--sale'],
          pixels: 974,
          collateralPixels: 0,
        },
      ],
    };

    expect(sourceOf(originOf(detail, 'CardFooter'))).toEqual(['app/src/components/ui/card.tsx']);
  });

  it('answers an empty list rather than a placeholder when neither record has a name', () => {
    // Absent is not empty and is not a sentence either. The row draws the space,
    // which is what *the run recorded nothing and the docket has no file* looks
    // like — not a line of prose apologising for it.
    expect(sourceOf(originOf(build([footer], []), 'CardFooter'))).toEqual([]);
  });
});

function say(origin: Origin, changes: readonly string[] = []): string {
  return renderToStaticMarkup(
    <Because origin={origin} build="9" changes={new Set(changes)} go={() => undefined} />,
  );
}

describe('the sentence on the change page is the run’s, rendered', () => {
  const footer = subject('story:product-card--sale', 'CardFooter');

  it('prints what the run wrote, with the names it claims about as code', () => {
    const html = say(originOf(build([footer], [movement()]), 'CardFooter'));

    expect(html).toContain('<code>ProductCard</code>');
    expect(html).toContain('<code>Card</code>');
    expect(html).toContain('it moved on what it was given');
    // The terminal's punctuation does not survive into the page as punctuation.
    expect(html).not.toContain('`');
  });

  it('offers the parent when the parent is a change on this build', () => {
    const detail = build(
      [footer, subject('story:product-card--dark', 'ProductCard')],
      [movement(), movement({ subject: 'story:product-card--dark', component: 'ProductCard' })],
    );

    expect(say(originOf(detail, 'CardFooter'), ['CardFooter', 'ProductCard'])).toContain(
      'Decide it under ProductCard',
    );
  });

  it('refuses the link when the parent has no page to send anyone to', () => {
    // `ProductCard` moved nowhere in this build, so it is named in a sentence and
    // is not a row on the docket. A link there is a click into an empty pane.
    expect(say(originOf(build([footer], [movement()]), 'CardFooter'), ['CardFooter'])).not.toContain(
      'Decide it under',
    );
  });

  it('prints both reasons, and how many renders each covers', () => {
    const detail = build(
      [subject('story:a', 'Button'), subject('story:b', 'Button'), subject('story:c', 'Button')],
      [
        movement({ subject: 'story:a', component: 'Button', cause: 'edited', because: 'a file' }),
        movement({ subject: 'story:b', component: 'Button', because: 'a parent' }),
        movement({ subject: 'story:c', component: 'Button', because: 'a parent' }),
      ],
    );
    const html = say(originOf(detail, 'Button'));

    expect(html).toContain('a parent');
    expect(html).toContain('a file');
    expect(html).toContain('in 2 renders of 3');
    expect(html).toContain('in 1 render of 3');
  });

  it('says nothing at all when the run recorded nothing', () => {
    // Not *no cause was found*. The store has no row, which is a fact about the
    // store, and a sentence about it belongs nowhere near a decision.
    expect(say(originOf(build([footer], []), 'CardFooter'))).toBe('');
  });

  it('marks a render already proven to read two ways, beside the reason', () => {
    const html = say(
      originOf(
        build([footer], [movement({ cause: 'unexplained', upstream: undefined, standing: 'flake' })]),
        'CardFooter',
      ),
    );

    expect(html).toContain('failed to read the same way twice');
  });
});

describe('the page’s own reconstruction stands down when the run answered', () => {
  const footer = subject('story:product-card--sale', 'CardFooter');

  function arrival(origin: Origin): string {
    return renderToStaticMarkup(<Arrival origin={origin} />);
  }

  it('drops the guess about a dependency the same page names a file for', () => {
    // `CardFooter` is declared in `app/src/components/ui/card.tsx`, which this
    // page prints at the top. The reach graph carries no such name because the
    // import walk climbs, not because the component came from `node_modules` —
    // and the sentence that said so was under the one that had it right.
    expect(arrival(originOf(build([footer], [movement()]), 'CardFooter'))).toBe('');
  });

  it('still says it when nothing was recorded, because then it is the only answer', () => {
    const html = arrival(originOf(build([footer], []), 'CardFooter'));

    expect(html).toContain('reaches nothing called');
  });

  it('keeps the hole in its own record, which no conclusion covers', () => {
    // A render with no reach row is not a render the commit fails to reach. The
    // run's sentence is about the renders it could read; this is the count it
    // could not, and dropping it with the guess would be a silent cap.
    const detail = build(
      [footer, subject('story:product-card--dark', 'CardFooter')],
      [movement()],
      { ...REACH, subjects: { 'story:product-card--sale': REACH.subjects['story:product-card--sale']! } },
    );

    expect(arrival(originOf(detail, 'CardFooter'))).toContain('no reach recorded at all');
  });
});
