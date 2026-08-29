import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RegionRecord } from '@variance-authority/report';
import type { BuildDetail, Cause, ReachView, SubjectView } from '../review-types.js';
import { createReviewClient } from './client.js';
import { originsOf } from './grouping.js';
import { OriginsPanel } from './origins.js';

/**
 * Grouping, held to the one thing a group can get wrong.
 *
 * A group is a claim that these subjects are one change, and a reviewer approves
 * on the strength of it. Every failure here is the same failure wearing a
 * different hat: a subject filed under an edit that did not cause it, approved in
 * a batch it was never part of, by somebody who read one sentence and clicked
 * once. There is no version of that a reviewer catches by looking harder.
 */

const CLIENT = createReviewClient({ endpoint: '/api', token: 'unused-in-a-static-render' });

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
  extra: { readonly causes?: readonly Cause[]; readonly reach?: ReachView | null } = {},
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
    coverage: { stated: true, failed: 0, excluded: 0 },
    subjects,
    notObserved: [],
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

describe('a change is one item, wherever it landed', () => {
  const shared = [
    subject({
      subject: 'story:button--default',
      regions: [region({ component: 'Button', pixels: 300, fingerprint: 'f1' })],
    }),
    subject({
      subject: 'story:card',
      regions: [
        region({ component: 'Button', pixels: 120, fingerprint: 'f1' }),
        region({ component: 'Stack', pixels: 900, cause: false }),
      ],
    }),
    subject({
      subject: 'route:/cart',
      regions: [
        region({ component: 'Button', pixels: 60, fingerprint: 'f1' }),
        region({ component: 'CartBadge', pixels: 40, cause: false }),
      ],
    }),
  ];

  it('files three renders of one edit as one decision', () => {
    const { origins } = originsOf(build(shared));

    expect(origins).toHaveLength(1);
    expect(origins[0]?.component).toBe('Button');
    expect(origins[0]?.appearances.map((each) => each.subject.subject)).toEqual([
      'story:button--default',
      'story:card',
      'route:/cart',
    ]);
    // The cause regions only. Folding in the 900px `Stack` reflow would credit
    // the edit with a number nobody attributed to it.
    expect(origins[0]?.pixels).toBe(480);
  });

  it('takes the cause the report led with, not the largest box on the screen', () => {
    // Ranking by area answers `Stack` — the container that reflowed — for a
    // change to the button inside it. Measured at 6x on one edit, and it is the
    // same rule the docket and the record read by; three readings of one fact
    // that disagree put a reviewer in front of a group explained by a component
    // that is not in it.
    const { origins } = originsOf(
      build([
        subject({
          regions: [
            region({ component: 'Button', pixels: 86, cause: true }),
            region({ component: 'Stack', pixels: 9000, cause: true }),
          ],
        }),
      ]),
    );

    expect(origins.map((each) => each.component)).toEqual(['Button']);
  });

  it('observes what moved alongside without claiming it was caused', () => {
    const { origins } = originsOf(build(shared));

    expect(origins[0]?.appearances[1]?.alongside).toEqual(['Stack']);
  });

  it('leaves a subject nothing named as its own item, never inside a group', () => {
    const { origins, unattributed } = originsOf(
      build([...shared, subject({ subject: 'route:/checkout', regions: [] })]),
    );

    expect(unattributed.map((each) => each.subject)).toEqual(['route:/checkout']);
    expect(origins[0]?.appearances).toHaveLength(3);
  });

  it('groups nothing that did not change', () => {
    // An unchanged subject in a batch is an approval of a render nobody was
    // shown a difference in.
    const { origins, unattributed } = originsOf(
      build([subject({ verdict: 'unchanged', regions: [region({ component: 'Button' })] })]),
    );

    expect(origins).toEqual([]);
    expect(unattributed).toEqual([]);
  });
});

describe('the card says what a reviewer is agreeing to', () => {
  function markup(detail: BuildDetail): string {
    return renderToStaticMarkup(
      <OriginsPanel client={CLIENT} reviewer="marina" build={detail} onDecided={() => undefined} />,
    );
  }

  it('names the component and the file it is declared in', () => {
    // Carried from the docket this replaces: a reviewer told `Button` and
    // `app/src/components/ui/button.tsx` can hand the change to whoever owns the
    // file.
    const page = markup(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })], {
        causes: CAUSES,
      }),
    );

    expect(page).toContain('Button');
    expect(page).toContain('app/src/components/ui/button.tsx');
  });

  it('counts collateral rather than splitting it between the changes', () => {
    const page = markup(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })], {
        causes: CAUSES,
      }),
    );

    expect(page).toContain('511 collateral pixels');
  });

  it('does not invent a change when the tier named no cause at all', () => {
    // Carried from the docket this replaces. The subject moved and nothing
    // claimed it; a page that filed it under the nearest component would hand a
    // reviewer somebody else's edit to approve it under.
    const page = markup(build([subject({ subject: 'route:/checkout', regions: [] })]));

    expect(page).toContain('Moved with nothing named as the cause');
    expect(page).toContain('route:/checkout');
    expect(page).not.toContain('Approve this change');
  });

  it('says so plainly when the build holds nothing to decide', () => {
    expect(markup(build([]))).toContain('Nothing in this build changed');
  });

  it('keeps the batch whole when the same component absorbed the change several ways', () => {
    // A shape is a pixel digest, so a restyle lands as one shape on the buttons
    // that are the same size and another on the one that is not. Refusing the
    // batch over that would refuse every real change on the strength of a
    // resolution — and the reviewer still made one edit to one component.
    const page = markup(
      build([
        subject({ subject: 'a', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
        subject({ subject: 'b', regions: [region({ component: 'Button', fingerprint: 'f2' })] }),
        subject({ subject: 'c', regions: [region({ component: 'Button', fingerprint: 'f2' })] }),
      ]),
    );

    expect(page).toContain('2 changes · 3 regions');
    expect(page).toContain('is 2 of the 3 appearances');
    expect(page).toContain('Approve this change (3)');
  });

  it('names the shared shape, which is the set the CLI can take on its own', () => {
    const page = markup(
      build([
        subject({ subject: 'a', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
        subject({ subject: 'b', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
      ]),
    );

    expect(page).toContain('1 change · 2 regions');
    expect(page).toContain('The same difference in every one of them');
    expect(page).toContain('variance accept --shape');
    expect(page).toContain('Approve this change (2)');
  });

  it('leads with the render the commit reaches nothing in, and not with the pixels', () => {
    // The finding no comparison can produce on its own: something moved and
    // nothing you wrote arrives anywhere in the picture. Silence would read as
    // reached, which is what a reviewer assumes by default.
    const page = markup(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })], {
        reach: {
          against: 'main',
          changed: ['app/src/lib/format.ts'],
          components: [{ component: 'PriceTag', trail: ['app/src/lib/format.ts', 'PriceTag'] }],
          subjects: {},
        },
      }),
    );

    expect(page).toContain('reaches nothing at all in 1 render');
    expect(page).toContain('story:card');
    expect(page).toContain('va-alarm');
  });

  it('does not raise the alarm over a component the graph was never asked about', () => {
    // The case that made the alarm worthless. `LinkComponent` is next/link's own
    // function name: it lives in a dependency, so it can never appear among the
    // components a diff of the repository reaches, whatever the commit did. The
    // renders it moved in *are* reached — through Button and MainNav — and the
    // page said *nothing reaches it and it changed anyway* about every one of
    // them, in the colour reserved for the render nothing accounts for.
    const page = markup(
      build([subject({ regions: [region({ component: 'LinkComponent', fingerprint: 'f1' })] })], {
        reach: {
          against: 'main',
          changed: ['app/src/components/ui/button.tsx'],
          components: [
            { component: 'Button', trail: ['app/src/components/ui/button.tsx', 'Button'] },
          ],
          subjects: {
            'story:card': { reached: true, through: ['Button', 'MainNav'], because: 'reached' },
          },
        },
      }),
    );

    expect(page).toContain('reaches nothing called');
    expect(page).toContain('through Button, MainNav');
    expect(page).not.toContain('va-alarm');
  });

  it('separates the two silences behind an unrecorded file', () => {
    // A blank cell reads as a defect in the tool. It is nearly always a name the
    // source index does not declare, and the run that resolved one for `Button`
    // is the evidence that it looked.
    const page = markup(
      build(
        [
          subject({ subject: 'a', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
          subject({
            subject: 'b',
            regions: [region({ component: 'LinkComponent', fingerprint: 'f2' })],
          }),
        ],
        { causes: CAUSES },
      ),
    );

    expect(page).toContain('not in the scanned source');
    expect(page).not.toContain('no source index');
    expect(markup(build([subject({ regions: [region({ component: 'Button' })] })]))).toContain(
      'no source index',
    );
  });

  it('offers the change to be looked at, from the card that decides it', () => {
    const page = markup(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })]),
    );

    expect(page).toContain('Look at the change');
  });

  it('draws the chain when it does reach it', () => {
    const page = markup(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })], {
        reach: {
          against: 'main',
          changed: ['app/src/ds/tokens.css'],
          components: [
            { component: 'Button', trail: ['app/src/ds/tokens.css', 'app/src/ds/button.tsx', 'Button'] },
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
    const page = markup(
      build([subject({ regions: [region({ component: 'Button', fingerprint: 'f1' })] })]),
    );

    expect(page).not.toContain('reaches nothing');
    expect(page).not.toContain('This commit reaches it');
  });
});
