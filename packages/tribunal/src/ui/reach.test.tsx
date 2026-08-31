import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BuildDetail, ReachView, SubjectView } from '../review-types.js';
import { createReviewClient } from './client.js';
import { ReachPanel, crossReach } from './reach.js';

/**
 * The crossing, held to the two claims it exists to make.
 *
 * Everything here is one of two failures. Either a quadrant says something the
 * record does not support — a subject called *unreached* on the strength of a
 * diff nothing could attribute, or one called *still* that nobody compared — or
 * the panel is silent where its whole value lies, which is the green subject the
 * commit reaches and the moved subject it does not.
 *
 * Both failures read as a working page. That is why they are asserted rather than
 * looked at.
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

function reach(overrides: Partial<ReachView> = {}): ReachView {
  return {
    against: 'main',
    changed: ['app/src/ds/tokens.css'],
    components: [
      {
        component: 'Button',
        trail: ['app/src/ds/tokens.css', 'app/src/ds/button.tsx', 'Button'],
      },
    ],
    subjects: {},
    ...overrides,
  };
}

function build(subjects: readonly SubjectView[], view: ReachView | null): BuildDetail {
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
    composition: null,
    causes: [],
    variations: [],
    reach: view,
  };
}

describe('the crossing seats a subject on both axes or on neither', () => {
  const subjects = [
    subject({ subject: 'expected', verdict: 'changed' }),
    subject({ subject: 'alarm', verdict: 'changed' }),
    subject({ subject: 'inert', verdict: 'unchanged' }),
    subject({ subject: 'quiet', verdict: 'unchanged' }),
  ];
  const view = reach({
    subjects: {
      expected: { reached: true, through: ['app/src/ds/tokens.css'], because: 'reached' },
      alarm: { reached: false, through: [], because: 'nothing reaches it' },
      inert: { reached: true, through: ['app/src/ds/tokens.css'], because: 'reached' },
      quiet: { reached: false, through: [], because: 'nothing reaches it' },
    },
  });

  it('produces the two findings no comparison can produce on its own', () => {
    const crossing = crossReach(subjects, view);

    // The whole point of the panel, and neither is derivable from an image pair:
    // a green subject the commit reaches, and a moved one it does not.
    expect(crossing.reachedStill.map((entry) => entry.subject)).toEqual(['inert']);
    expect(crossing.unreachedMoved.map((entry) => entry.subject)).toEqual(['alarm']);
    expect(crossing.reachedMoved.map((entry) => entry.subject)).toEqual(['expected']);
    expect(crossing.unreachedStill).toBe(1);
  });

  it('counts a subject the baselines could not describe rather than calling it unreached', () => {
    // A baseline that recorded no component list is a subject this surface cannot
    // answer for. `reached: false` there would be an assertion nobody made, and
    // it would be filed in the quadrant nobody reads.
    const crossing = crossReach([...subjects, subject({ subject: 'unlisted' })], view);

    expect(crossing.unplaced).toBe(1);
    expect(crossing.unreachedMoved.map((entry) => entry.subject)).toEqual(['alarm']);
  });

  it('keeps a verdict that compared nothing off the moved-or-still axis', () => {
    const crossing = crossReach(
      [subject({ subject: 'fresh', verdict: 'new' }), subject({ subject: 'broken', verdict: 'incomparable' })],
      reach({
        subjects: {
          fresh: { reached: true, through: ['app/src/ds/tokens.css'], because: 'reached' },
          broken: { reached: false, through: [], because: 'nothing reaches it' },
        },
      }),
    );

    // `new` has no baseline to have moved from, and `incomparable` is a
    // comparison that did not happen. Either one filed as "still" would report a
    // missing measurement as a clean one.
    expect(crossing.incomparable).toBe(2);
    expect(crossing.reachedStill).toEqual([]);
    expect(crossing.unreachedStill).toBe(0);
  });

  it('keeps a subject nothing rendered out of the quadrant that says it did not move', () => {
    // A narrowed run never opens what the diff cannot reach. Counting those as
    // *untouched, and still* claims a comparison for subjects no browser loaded,
    // and counting them as nothing leaves the page reading `0` beside a coverage
    // line that just said eighteen — the same build answering itself twice.
    const crossing = crossReach(subjects, view, [
      { subject: 'route/home', kind: 'unreached', because: 'its baseline records none of it' },
      { subject: 'story:legacy', kind: 'excluded', because: 'excluded by config' },
      { subject: 'story:modal', kind: 'failed', because: 'the renderer crashed' },
    ]);

    expect(crossing.unreachedSkipped).toBe(1);
    expect(crossing.unreachedStill).toBe(1);
  });
});

describe('the panel', () => {
  it('draws nothing at all when the run carried no diff', () => {
    // No ref to read against is not the same as a diff that reached nothing, and
    // an empty grid would say the second on the authority of the first.
    expect(renderToStaticMarkup(<ReachPanel client={CLIENT} build={build([], null)} />)).toBe('');
  });

  it('draws the refusal instead of the grid, not beside it', () => {
    const markup = renderToStaticMarkup(
      <ReachPanel
        client={CLIENT}
        build={build(
          [subject({ verdict: 'changed' })],
          reach({ subjects: undefined, whole: 'none of the 1 changed file is in the file graph' }),
        )}
      />,
    );

    // Four zeroes over an unattributed diff reads as "this commit reaches none of
    // your subjects", which is a sentence somebody merges on.
    expect(markup).not.toContain('va-quad');
    expect(markup).toContain('may be called unreached');
    expect(markup).toContain('none of the 1 changed file is in the file graph');
  });

  it('draws an empty quadrant rather than omitting it', () => {
    const markup = renderToStaticMarkup(
      <ReachPanel
        client={CLIENT}
        build={build(
          [subject({ subject: 'a', verdict: 'changed' })],
          reach({ subjects: { a: { reached: true, through: ['app/src/ds/tokens.css'], because: 'reached' } } }),
        )}
      />,
    );

    // A missing cell reads as a question nobody asked; a zero is the answer to it.
    expect(markup).toContain('moved, unreached');
    expect(markup).toContain('va-zero');
  });

  it('reads the record for an unexplained subject without being asked', () => {
    const markup = renderToStaticMarkup(
      <ReachPanel
        client={CLIENT}
        build={build(
          [subject({ subject: 'alarm', verdict: 'changed' })],
          reach({ subjects: { alarm: { reached: false, through: [], because: 'nothing reaches it' } } }),
        )}
      />,
    );

    // "Has this moved on its own before" is the entire reason the row is there.
    // Waiting to be asked it would be waiting to be asked the point.
    expect(markup).toContain('Moved with nothing reaching it');
    expect(markup).toContain('Reading the record');
  });

  it('names the chain rather than the component it arrives at', () => {
    const markup = renderToStaticMarkup(
      <ReachPanel client={CLIENT} build={build([], reach())} />,
    );

    // A component on its own is an assertion. The chain is a claim a reviewer can
    // open three files and disprove.
    expect(markup).toContain('app/src/ds/tokens.css');
    expect(markup).toContain('app/src/ds/button.tsx');
    expect(markup).toContain('<strong>Button</strong>');
  });

  it('names the files the scan could not place, rather than counting them', () => {
    const markup = renderToStaticMarkup(
      <ReachPanel
        client={CLIENT}
        build={build(
          [],
          reach({
            unscanned: ['app/src/generated/icons.ts'],
            opaque: [{ file: 'app/src/ds/theme.ts', because: 'the parser refused it' }],
          }),
        )}
      />,
    );

    // Both are things an operator can go and fix, and a bare count tells them
    // there is nothing to do.
    expect(markup).toContain('app/src/generated/icons.ts');
    expect(markup).toContain('app/src/ds/theme.ts');
  });
});
