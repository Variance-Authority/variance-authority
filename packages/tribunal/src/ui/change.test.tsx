import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RegionRecord } from '@variance-authority/report';
import type { BuildDetail, Cause, Placement, ReachView, SubjectView } from '../review-types.js';
import { ChangePanel } from './change.js';
import { createReviewClient } from './client.js';
import type { Crossing } from './crossing.js';
import { originsOf } from './grouping.js';
import { divergeFrom } from './shift.js';

/**
 * The page a decision is actually made on, held to what it must say before the
 * two buttons.
 *
 * Every failure here is the same failure: a reviewer approving a change on the
 * strength of a card that told them nothing they could check. The card that
 * preceded this one carried a name, a file, a ratio and a fingerprint, and a
 * reviewer who read all four still did not know whether the commit reached it,
 * whether the last run had already shown it to them, or what it looked like.
 */

const CLIENT = createReviewClient({ endpoint: '/api', token: 'unused-in-a-static-render' });
const NO_CROSSING: Crossing = { state: 'none' };

function region(overrides: Partial<RegionRecord> = {}): RegionRecord {
  return { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, ...overrides };
}

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

function build(
  subjects: readonly SubjectView[],
  extra: {
    readonly causes?: readonly Cause[];
    readonly reach?: ReachView | null;
    readonly composition?: readonly Placement[] | null;
  } = {},
): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '4',
    commit: 'abc1234',
    at: '2026-06-01T12:00:00.000Z',
    identity: { browser: 'chromium', viewport: { width: 1280, height: 800 } } as never,
    retention: 'durable',
    verdicts: { changed: 1, unchanged: 0, new: 0, incomparable: 0, unstable: 0, ignored: 0 },
    decided: 0,
    pending: 1,
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
    subjects,
    notObserved: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: extra.composition ?? null,
    causes: extra.causes ?? [],
    variations: [],
    reach: extra.reach ?? null,
  };
}

const CAUSES: readonly Cause[] = [
  {
    component: 'Button',
    file: 'app/src/components/ui/button.tsx',
    subjects: ['story:card'],
    pixels: 86,
    collateralPixels: 511,
  },
];

/** The change this build's first origin describes, drawn. */
function card(
  detail: BuildDetail,
  crossing: Crossing = NO_CROSSING,
  changes: ReadonlySet<string> = new Set(),
): string {
  const origin = originsOf(detail).origins[0];
  if (origin === undefined) throw new Error('this build holds no change to draw');

  return renderToStaticMarkup(
    <ChangePanel
      client={CLIENT}
      reviewer="marina"
      build={detail}
      origin={origin}
      crossing={crossing}
      changes={changes}
      go={() => undefined}
      onDecided={() => undefined}
    />,
  );
}

describe('the card says what a reviewer is agreeing to', () => {
  it('names the component and the file it is declared in', () => {
    const page = card(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })], {
        causes: CAUSES,
      }),
    );

    expect(page).toContain('Button');
    expect(page).toContain('app/src/components/ui/button.tsx');
  });

  it('leads with the renders rather than the pixels', () => {
    // One edit in eleven places is a different afternoon from eleven edits in
    // eleven places, and a pixel total cannot tell them apart.
    const page = card(
      build([
        subject({ subject: 'a', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
        subject({ subject: 'b', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
      ]),
    );

    expect(page).toContain('<strong>1 difference</strong> to review');
    expect(page).toContain('<strong>2 renders</strong> to know about');
    expect(page).toContain('<strong>2 renders</strong> to accept');
  });

  it('counts collateral for the build and never splits it between the changes', () => {
    const page = card(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })], {
        causes: CAUSES,
      }),
    );

    expect(page).toContain('511 collateral pixels');
    expect(page).toContain('never split between the changes');
  });

  it('prints no collateral line at all when the build counted none', () => {
    // Absent is not zero. `0 collateral pixels` reads as a measurement, and this
    // build made none.
    const page = card(build([subject({ regions: [region({ component: 'Button' })] })]));

    expect(page).not.toContain('collateral pixel');
  });

  it('keeps the batch whole when the same component absorbed the change several ways', () => {
    // A shape is a pixel digest, so a restyle lands as one shape on the buttons
    // that are the same size and another on the one that is not. Refusing the
    // batch over that would refuse every real change on the strength of a
    // resolution — and the reviewer still made one edit to one component.
    const page = card(
      build([
        subject({ subject: 'a', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
        subject({ subject: 'b', regions: [region({ component: 'Button', fingerprint: 'f2' })] }),
        subject({ subject: 'c', regions: [region({ component: 'Button', fingerprint: 'f2' })] }),
      ]),
    );

    expect(page).toContain('<strong>2 differences</strong> to review');
    expect(page).toContain('2 shapes over 3 renders');
    expect(page).toContain('Approve this change (3)');
  });

  it('puts the buttons above the reasons, not below them', () => {
    // Every line under the head is a reason to press one or to refuse. A reviewer
    // who has read them should not scroll back past the reasons to act.
    const page = card(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })]),
    );

    expect(page.indexOf('Approve this change')).toBeLessThan(page.indexOf('Where it showed up'));
  });

  it('offers every render its own decision as well as the batch', () => {
    const page = card(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })]),
    );

    expect(page).toContain('va-where-row');
    expect(page).toContain('href="/builds/4/subjects/story%3Acard"');
  });

  it('draws the difference on arrival, one crop per shape, with nothing to press', () => {
    // A reviewer cannot approve what they have not seen, and they will not open
    // four renders to see four differences. The strip used to be behind a *look
    // at the change* button and capped at three; both were a cost argument
    // answered in the reviewer's time.
    const seen = (name: string, fingerprint: string): SubjectView =>
      subject({
        subject: name,
        size: { width: 400, height: 300 },
        regions: [region({ component: 'Button', fingerprint })],
      });

    const page = card(build([seen('a', 'f1'), seen('b', 'f2'), seen('c', 'f2')]));

    expect(page).not.toContain('Look at the change');
    expect(page.match(/va-crop-plate/g)).toHaveLength(2);
    expect(page).toContain('/subjects/a/diff.png');
    expect(page).toContain('/subjects/b/diff.png');
  });
});

describe('whether the commit arrives here, in five states rather than two', () => {
  const reaching = (components: readonly string[], subjects: ReachView['subjects']): ReachView => ({
    against: 'main',
    changed: ['app/src/components/ui/button.tsx'],
    components: components.map((component) => ({
      component,
      trail: ['app/src/components/ui/button.tsx', component],
    })),
    ...(subjects === undefined ? {} : { subjects }),
  });

  it('leads with the render the commit reaches nothing in', () => {
    // The finding no comparison can produce on its own: something moved and
    // nothing you wrote arrives anywhere in the picture.
    const page = card(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })], {
        reach: reaching(['PriceTag'], {
          'story:card': { reached: false, through: [], because: 'nothing reaches it' },
        }),
      }),
    );

    expect(page).toContain('reaches nothing at all in 1 render');
    expect(page).toContain('va-alarm');
  });

  it('does not raise the alarm over a component the graph was never asked about', () => {
    // The case that made the alarm worthless. `LinkComponent` is next/link's own
    // function name: it lives in a dependency, so it can never appear among the
    // components a diff of the repository reaches, whatever the commit did.
    const page = card(
      build([subject({ regions: [region({ component: 'LinkComponent', fingerprint: 'f1' })] })], {
        reach: reaching(['Button'], {
          'story:card': { reached: true, through: ['Button', 'MainNav'], because: 'reached' },
        }),
      }),
    );

    expect(page).toContain('reaches nothing called');
    expect(page).toContain('through Button, MainNav');
    expect(page).not.toContain('va-alarm');
  });

  it('says a render has no reach recorded rather than calling it unreached', () => {
    // Absent is not empty. A report with component-level reach and no per-subject
    // block put every render in the unreached pile, and the page spent its
    // loudest sentence on the ordinary fact that nobody wrote the row down.
    const page = card(
      build([subject({ regions: [region({ component: 'LinkComponent', fingerprint: 'f1' })] })], {
        reach: reaching(['Button'], {}),
      }),
    );

    expect(page).toContain('no reach recorded at all');
    expect(page).not.toContain('va-alarm');
  });

  it('draws the chain when it does reach it', () => {
    const page = card(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })], {
        reach: {
          against: 'main',
          changed: ['app/src/ds/tokens.css'],
          components: [
            {
              component: 'Button',
              trail: ['app/src/ds/tokens.css', 'app/src/ds/button.tsx', 'Button'],
            },
          ],
          subjects: {},
        },
      }),
    );

    expect(page).toContain('app/src/ds/tokens.css');
    expect(page).toContain('<strong>Button</strong>');
    expect(page).not.toContain('reaches nothing');
  });

  it('says nothing about reach when the run carried no diff', () => {
    // Absent is not `false`. A run with no ref to read against never asked the
    // question, and printing the alarm would be an answer nobody gave.
    const page = card(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })]),
    );

    expect(page).not.toContain('reaches nothing');
    expect(page).not.toContain('This commit reaches it');
  });

  it('separates the two silences behind an unrecorded file', () => {
    // A blank cell reads as a defect in the tool. It is nearly always a name the
    // source index does not declare, and the run that resolved one for `Button`
    // is the evidence that it looked.
    const sourced = card(
      build([subject({ regions: [region({ component: 'LinkComponent', fingerprint: 'f1' })] })], {
        causes: CAUSES,
      }),
    );

    expect(sourced).toContain('not in the scanned source');
    expect(card(build([subject({ regions: [region({ component: 'Button' })] })]))).toContain(
      'no source index',
    );
  });
});

describe('what the last run said, beside the change rather than nine thousand pixels below it', () => {
  /** A crossing of this build against an earlier one, folded as the page folds it. */
  function against(now: BuildDetail, earlier: BuildDetail): Crossing {
    const divergence = divergeFrom(now, earlier);
    const rows = new Map(divergence.shifts.map((each) => [each.subject, each]));
    return { state: 'ready', earlier, divergence, of: (name) => rows.get(name) };
  }

  const moved = (overrides: Partial<SubjectView> = {}): SubjectView =>
    subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })], ...overrides });

  it('says the same difference arrived undecided, in the words that carry it', () => {
    // The sentence a reviewer skips work on, and the one this whole crossing
    // exists to print. It is worth reading beside the change and worth nothing at
    // the bottom of a page about twenty other subjects — and it is worth nothing
    // at all in the trade's own dialect, which is what *the second delivery of
    // the same docket* was.
    const now = build([moved()]);
    const page = card(now, against(now, build([moved()])));

    expect(page).toContain('carried the same difference in build 4');
    expect(page).toContain('none of them was decided there');
  });

  it('does not say it twice when somebody did decide it', () => {
    const now = build([moved()]);
    const earlier = build([
      moved({ decision: { decision: 'approved', by: 'marina', at: '2026-06-01T09:00:00.000Z' } }),
    ]);

    const page = card(now, against(now, earlier));

    expect(page).toContain('every one was decided there');
    expect(page).not.toContain('none of them');
  });

  it('names a difference that changed since, rather than calling it seen', () => {
    const now = build([moved()]);
    const earlier = build([
      subject({ regions: [region({ component: 'Button', fingerprint: 'f9' })] }),
    ]);

    const page = card(now, against(now, earlier));

    expect(page).toContain('the difference itself changed between the two builds');
  });

  it('says nothing at all when there is no earlier run to say it against', () => {
    const page = card(build([moved()]));

    expect(page).not.toContain('carried the same difference');
  });
});

describe('an edit of its own, and a prop somebody else wrote', () => {
  // The complaint, end to end. One revision restyles `ui/button.tsx` and adds an
  // `aria-label` to the button `ProductCard` mounts, and the page unioned the
  // two: *Button moved in what it announces, its layout and its style values*,
  // over a byline naming `button.tsx`. A reviewer sent to that file for a
  // renamed control finds nothing in it that could have done it.
  const place = (
    component: string,
    subjects: readonly string[],
    within: readonly string[] = [],
  ): Placement => ({ component, subjects, within, createdBy: [], renders: [] });

  const CENSUS: readonly Placement[] = [
    place('Button', ['story:card', 'story:plain'], ['ProductCard']),
    place('ProductCard', ['story:card']),
  ];

  const REACHED: ReachView = {
    against: 'main',
    changed: ['app/src/components/ProductCard.tsx', 'app/src/components/ui/button.tsx'],
    components: [
      { component: 'Button', trail: ['app/src/components/ui/button.tsx', 'Button'] },
      { component: 'ProductCard', trail: ['app/src/components/ProductCard.tsx', 'ProductCard'] },
    ],
  };

  const mixed = (): BuildDetail =>
    build(
      [
        subject({
          subject: 'story:card',
          regions: [region({ component: 'Button', fingerprint: 'f1' })],
          moved: [{ component: 'Button', bands: ['a11y', 'token'], cause: true }],
        }),
        subject({
          subject: 'story:plain',
          regions: [region({ component: 'Button', fingerprint: 'f2' })],
          moved: [{ component: 'Button', bands: ['token'], cause: true }],
        }),
      ],
      { causes: CAUSES, composition: CENSUS, reach: REACHED },
    );

  it('leaves the parent’s band out of the sentence about this component', () => {
    const page = card(mixed());

    expect(page).toContain('moved in <em>its style values</em>');
    expect(page).not.toContain('what it announces, its style values');
  });

  it('names the parent that owns it, with the partition that found it', () => {
    const page = card(mixed(), NO_CROSSING, new Set(['ProductCard']));

    expect(page).toContain('what it announces');
    expect(page).toContain('/builds/4/changes/ProductCard');
    expect(page).toContain('1 render it draws');
  });
});

describe('what a press of the button settles that is not this change', () => {
  // A decision is taken on the whole picture. Two of these three renders hold a
  // `CardFooter` that moved on its own and has an approve button of its own,
  // and pressing this one presses that one by proxy.
  const detail = build([
    subject({
      subject: 'story:button--primary',
      regions: [{ x: 0, y: 0, width: 8, height: 8, pixels: 100, component: 'Button', cause: true }],
      moved: [{ component: 'Button', bands: ['token'], cause: true }],
    }),
    subject({
      subject: 'story:product-card--sale',
      regions: [{ x: 0, y: 0, width: 8, height: 8, pixels: 100, component: 'Button', cause: true }],
      moved: [
        { component: 'Button', bands: ['token'], cause: true },
        { component: 'Card', bands: ['geometry'], cause: false },
        { component: 'CardFooter', bands: ['a11y', 'content'], cause: true },
      ],
    }),
    subject({
      subject: 'route/sneakers@1280',
      regions: [{ x: 0, y: 0, width: 8, height: 8, pixels: 100, component: 'Button', cause: true }],
      moved: [
        { component: 'Button', bands: ['token'], cause: true },
        { component: 'CardFooter', bands: ['a11y'], cause: true },
      ],
    }),
  ]);

  it('says how many renders carry another change, and links it', () => {
    const page = card(detail, NO_CROSSING, new Set(['CardFooter']));

    expect(page).toContain('<strong>2 of 3 renders</strong> also carry');
    expect(page).toContain('href="/builds/4/changes/CardFooter"');
    expect(page).toContain('approving here accepts those in the same renders');
  });

  it('marks the rows a single ✓ would settle two changes in', () => {
    const page = card(detail, NO_CROSSING, new Set(['CardFooter']));

    expect(page.match(/also CardFooter/g)).toHaveLength(2);
  });

  it('leaves a container that only reflowed off the warning', () => {
    // `Card` moved in one of them with `cause` false. Naming it would put every
    // framework wrapper on the alarm and make the two real names unfindable.
    expect(card(detail, NO_CROSSING, new Set(['CardFooter']))).not.toContain('also Card,');
  });

  it('says what a band claim is made of rather than asserting it', () => {
    const page = card(detail, NO_CROSSING, new Set());

    expect(page).toContain('Each band is a digest comparison');
    expect(page).toContain('the role, name and state of every node in it');
    expect(page).toContain('keeps the digests and not the values');
  });
});
