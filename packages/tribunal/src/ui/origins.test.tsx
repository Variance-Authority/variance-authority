import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { RegionRecord } from '@variance-authority/report';
import type { BuildDetail, Cause, ReachView, SubjectView } from '../review-types.js';
import type { Crossing } from './crossing.js';
import { originsOf } from './grouping.js';
import { OriginsPanel } from './origins.js';
import type { Order } from './route.js';

/**
 * Grouping, held to the one thing a group can get wrong.
 *
 * A group is a claim that these subjects are one change, and a reviewer approves
 * on the strength of it. Every failure here is the same failure wearing a
 * different hat: a subject filed under an edit that did not cause it, approved in
 * a batch it was never part of, by somebody who read one sentence and clicked
 * once. There is no version of that a reviewer catches by looking harder.
 */

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
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: null,
    causes: extra.causes ?? [],
    variations: [],
    reach: extra.reach ?? null,
  };
}

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


describe('the rail is scanned, not read', () => {
  function rail(detail: BuildDetail, order: Order = 'story'): string {
    return renderToStaticMarkup(
      <OriginsPanel build={detail} crossing={NO_CROSSING} order={order} go={() => undefined} />,
    );
  }

  const reached = (components: readonly string[]): ReachView => ({
    against: 'main',
    changed: ['app/src/components/ui/button.tsx'],
    components: components.map((component) => ({
      component,
      trail: ['app/src/components/ui/button.tsx', component],
    })),
    subjects: {},
  });

  it('says which change a row is, how far it went, and nothing a reviewer cannot act on', () => {
    // The row this replaces carried a component, a file path, a ratio and a
    // fingerprint. The hash is the *identity* of a finding rather than a finding,
    // and it was on the third line of every row in the build.
    const page = rail(
      build([
        subject({ subject: 'a', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
        subject({ subject: 'b', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
      ]),
    );

    expect(page).toContain('Button');
    expect(page).toContain('2 renders');
    expect(page).not.toContain('f1');
  });

  it('counts the distinct differences on the row when there is more than one', () => {
    const page = rail(
      build([
        subject({ subject: 'a', regions: [region({ component: 'Button', fingerprint: 'f1' })] }),
        subject({ subject: 'b', regions: [region({ component: 'Button', fingerprint: 'f2' })] }),
      ]),
    );

    expect(page).toContain('2 shapes');
  });

  it('opens with the changes the commit reaches nothing in, not the biggest', () => {
    // The band order is the docket's whole argument. Largest-first is the
    // category's ranking, and it puts the container that reflowed furthest above
    // the change nothing in the commit accounts for.
    const page = rail(
      build(
        [
          subject({
            subject: 'a',
            regions: [region({ component: 'Button', pixels: 90_000, fingerprint: 'f1' })],
          }),
          subject({
            subject: 'b',
            regions: [region({ component: 'Orphan', pixels: 20, fingerprint: 'f2' })],
          }),
        ],
        {
          reach: {
            ...reached(['Button']),
            subjects: { b: { reached: false, through: [], because: 'nothing reaches it' } },
          },
        },
      ),
    );

    expect(page.indexOf('Nothing reaches these')).toBeLessThan(page.indexOf('You edited these'));
    expect(page.indexOf('Orphan')).toBeLessThan(page.indexOf('Button'));
  });

  it('does not band a change nobody has to act on with the alarms', () => {
    const page = rail(
      build([
        subject({
          subject: 'a',
          regions: [region({ component: 'Button', fingerprint: 'f1' })],
          decision: { decision: 'approved', by: 'marina', at: '2026-06-01T09:00:00.000Z' },
        }),
      ]),
    );

    expect(page).toContain('Already decided');
    expect(page).not.toContain('No diff read');
  });

  it('separates a name the diff cannot reach from a render it reaches nothing in', () => {
    // The two are one band apart and worlds apart. `LinkComponent` is next/link's
    // own function name — it can never be in a diff of this repository, whatever
    // the commit did — and the version of this page that filed it beside a real
    // orphan trained the alarm out of every reader.
    const page = rail(
      build([subject({ regions: [region({ component: 'LinkComponent', fingerprint: 'f1' })] })], {
        reach: {
          ...reached(['Button']),
          subjects: {
            'story:card': { reached: true, through: ['Button'], because: 'reached' },
          },
        },
      }),
    );

    expect(page).toContain('Not in the diff');
    expect(page).not.toContain('Nothing reaches these');
  });

  it('says nothing about reach when the run carried no diff, rather than guessing', () => {
    expect(rail(build([subject({ regions: [region({ component: 'Button' })] })]))).toContain(
      'No diff read',
    );
  });

  it('offers the reader the three orders the bands are not', () => {
    // A band is a claim, and a reviewer is allowed to disbelieve it. The orders
    // are addresses so the arrangement travels with the link.
    const page = rail(build([subject({ regions: [region({ component: 'Button' })] })]), 'size');

    expect(page).toContain('Every change, largest first');
    expect(page).toContain('/builds/4?order=places');
    // The default is elided: `?order=story` and no query are one address.
    expect(page).toContain('href="/builds/4"');
  });

  it('leaves a render no region claimed in its own band, never inside a change', () => {
    // A difference with no component named as its cause has no change to be
    // decided under, and filing it in somebody else's group would hand a reviewer
    // an unrelated edit to approve it beneath.
    const page = rail(build([subject({ subject: 'route:/checkout', regions: [] })]));

    expect(page).toContain('No region named these');
    expect(page).toContain('route:/checkout');
  });

  it('names what the hashes blamed in a render the regions could not', () => {
    // The band used to say nothing had named these, which was false on every
    // build carrying component hashes — and false in the expensive direction. A
    // region is resolved from the box the pixels drew, so it fails exactly when
    // an edit reflows its neighbours into one blob. What is missing is the box.
    const page = rail(
      build([
        subject({
          subject: 'route:/checkout',
          regions: [],
          moved: [
            { component: 'Button', bands: ['token'], cause: true },
            { component: 'CardFooter', bands: ['content'], cause: true },
            { component: 'LinkComponent', bands: ['geometry'], cause: true },
            { component: 'Shell', bands: ['geometry'], cause: false },
          ],
        }),
      ]),
    );

    expect(page).toContain('hashes name Button, CardFooter');
    expect(page).toContain('+1');
    expect(page).not.toContain('Shell');
  });

  it('falls back to the region count rather than claiming an empty list', () => {
    // Absent is not empty. A baseline with no hashes has not established that
    // nothing caused this, and a row printing an empty blame list would say it had.
    expect(rail(build([subject({ subject: 'route:/checkout', regions: [] })]))).toContain(
      '0 regions',
    );
  });

  it('says so plainly when the build holds nothing to decide', () => {
    expect(rail(build([]))).toContain('Nothing in this build changed');
  });

  it('links a change to its own address, so it can be sent to somebody', () => {
    const page = rail(build([subject({ regions: [region({ component: 'Button' })] })]));

    expect(page).toContain('href="/builds/4/changes/Button"');
  });
});
