import { describe, expect, it } from 'vitest';
import type { BuildDetail, SubjectView } from '../review-types.js';
import { distanceFrom, howFar, placed, spreadOf } from './distance.js';

/**
 * Distance and depth, held to the one failure that matters: claiming a
 * relationship the graph does not contain.
 *
 * Every state here is a different sentence on a reviewer's screen, and two of
 * them are alarms. *Nothing in the commit reaches it* is the loudest thing this
 * surface says about a passenger, and it must not be reachable from a build that
 * carried no diff, from a component the traversal never saw, or from a scan that
 * refused to attribute — those are three ways of not knowing, and none of them is
 * evidence.
 */

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
    coverage: { stated: true, failed: 0, excluded: 0 },
    subjects: [],
    notObserved: [],
    causes: [],
    variations: [],
    declarations: { ignores: null, sensitivities: null },
    reach: {
      against: 'main',
      changed: ['app/tokens.css'],
      components: [
        { component: 'Button', trail: ['app/tokens.css', 'ui/button.tsx', 'Button'] },
        {
          component: 'Card',
          trail: ['app/tokens.css', 'ui/button.tsx', 'ui/card.tsx', 'Card'],
        },
        { component: 'Badge', trail: ['app/tokens.css', 'ui/button.tsx', 'Badge'] },
        { component: 'Nav', trail: ['app/tokens.css', 'ui/nav.tsx', 'Nav'] },
      ],
    },
    ...over,
  };
}

function changed(subject: string, over: Partial<SubjectView> = {}): SubjectView {
  return {
    subject,
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 900,
    regions: [],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...over,
  };
}

describe('how far a component is from the change', () => {
  const far = distanceFrom(build(), 'Button');

  it('calls a component declared beside it the same file', () => {
    expect(far('Badge')).toEqual({ kind: 'same-file' });
  });

  it('counts the imports between the change and the thing that imports it', () => {
    expect(far('Card')).toEqual({ kind: 'importer', hops: 1 });
    expect(howFar(far('Card'))).toBe('imports it');
  });

  it('reads the chain the other way when the change is the one downstream', () => {
    expect(distanceFrom(build(), 'Card')('Button')).toEqual({ kind: 'imported', hops: 1 });
  });

  it('separates reached-by-another-path from not reached at all', () => {
    // Both are *not related to this change*, and only one of them is a finding.
    // A component the commit reaches through its own chain moved for a reason the
    // diff can explain; one it reaches by nothing did not.
    expect(far('Nav')).toEqual({ kind: 'apart' });
    expect(far('Portal')).toEqual({ kind: 'unreached' });
  });

  it('says nothing about a component nothing places, rather than the same three words', () => {
    // The row it would have gone on carries no chip at all. A column that reads
    // *the diff does not name it* nine times down a list of nine has spent nine
    // lines saying one thing about the graph as though it were nine facts about
    // the components.
    expect(howFar({ kind: 'unreached' })).toBeUndefined();
    expect(placed({ kind: 'unreached' })).toBe(false);
    expect(placed({ kind: 'apart' })).toBe(true);
  });

  it('places a component off the traversal by the file the docket recorded for it', () => {
    // The walk goes up from the edit, so anything the edited file *imports* is
    // outside it — and `ui/card.tsx` is where a reviewer would look next.
    const named = distanceFrom(
      build({
        causes: [
          { component: 'Button', file: 'ui/button.tsx:41', subjects: [], pixels: 1, collateralPixels: 0 },
          { component: 'CardFooter', file: 'ui/card.tsx:67', subjects: [], pixels: 1, collateralPixels: 0 },
        ],
      }),
      'Button',
    );

    expect(named('CardFooter')).toEqual({ kind: 'declared', file: 'ui/card.tsx', edited: false });
    expect(howFar(named('CardFooter'))).toBe('card.tsx, untouched by this commit');
    expect(placed(named('CardFooter'))).toBe(true);
  });

  it('calls two components declared in one file the same file, reached or not', () => {
    const named = distanceFrom(
      build({
        causes: [
          { component: 'CardFooter', file: 'ui/card.tsx:67', subjects: [], pixels: 1, collateralPixels: 0 },
          { component: 'CardHeader', file: 'ui/card.tsx:12', subjects: [], pixels: 1, collateralPixels: 0 },
        ],
      }),
      'CardFooter',
    );

    expect(named('CardHeader')).toEqual({ kind: 'same-file' });
  });

  it('says a file the commit changed declares it, which is not the same as unreached', () => {
    // A component in an edited file that the traversal still missed: the walk has
    // a hole, and printing *nothing reaches it* over the file the diff is in
    // would be the surface arguing against the diff in front of it.
    const named = distanceFrom(
      build({
        causes: [
          { component: 'Comp', file: 'app/tokens.css:9', subjects: [], pixels: 1, collateralPixels: 0 },
        ],
      }),
      'Button',
    );

    expect(named('Comp')).toEqual({ kind: 'declared', file: 'app/tokens.css', edited: true });
    expect(howFar(named('Comp'))).toBe('tokens.css, which this commit changed');
  });

  it('answers unknown, and says nothing, when no diff was read', () => {
    const blind = distanceFrom(build({ reach: null }), 'Button');

    expect(blind('Card')).toEqual({ kind: 'unknown' });
    expect(howFar(blind('Card'))).toBeUndefined();
  });

  it('answers unknown when the run had a diff and refused to attribute it', () => {
    // `whole` is the refusal. Measuring against `components` anyway would turn a
    // stated *I could not work this out* into four confident distances.
    const refused = build({
      reach: { ...build().reach!, whole: 'the merge base could not be resolved' },
    });

    expect(distanceFrom(refused, 'Button')('Card')).toEqual({ kind: 'unknown' });
  });
});

describe('how far the edit landed, as a histogram', () => {
  it('counts what the commit reaches at each depth, and what moved there', () => {
    const spread = spreadOf(
      build({
        subjects: [
          changed('story:card', {
            moved: [
              { component: 'Button', bands: ['token'], cause: true },
              { component: 'Card', bands: ['geometry'], cause: false },
            ],
          }),
        ],
      }),
    );

    // Depth is imports from an edited file: Button and Badge are declared one
    // import out, Card two, Nav one by its own chain.
    expect(spread?.rungs).toEqual([
      { depth: 1, reached: 3, moved: 1 },
      { depth: 2, reached: 1, moved: 0 },
    ]);
  });

  it('counts a component that moved and the diff never named, off the axis', () => {
    // Every rung is a distance from an edited file, so a component the traversal
    // never arrived at has no rung. Dropped in silence, a build whose loudest
    // movement is entirely off the graph reads as one that stayed inside its diff.
    const spread = spreadOf(
      build({
        subjects: [
          changed('story:card', {
            moved: [{ component: 'CardFooter', bands: ['content'], cause: true }],
          }),
        ],
      }),
    );

    expect(spread?.undeclared).toEqual(['CardFooter']);
    expect(spread?.rungs.every((rung) => rung.moved === 0)).toBe(true);
  });

  it('reads a region lead as movement too, not only the hashes', () => {
    const spread = spreadOf(
      build({
        subjects: [
          changed('route/cart@1280', {
            regions: [{ x: 0, y: 0, width: 4, height: 4, pixels: 16, cause: true, component: 'Nav' }],
          }),
        ],
      }),
    );

    expect(spread?.rungs.find((rung) => rung.depth === 1)?.moved).toBe(1);
  });

  it('keeps a component reached through an unreadable file off the axis', () => {
    // Its depth is measured from the scan's blind spot, not from the edit. Folded
    // in, it would put the scanner's own gaps on the same scale as consequences.
    const spread = spreadOf(
      build({
        reach: {
          ...build().reach!,
          components: [
            { component: 'Button', trail: ['app/tokens.css', 'ui/button.tsx', 'Button'] },
            { component: 'Ghost', trail: ['vendor/opaque.js', 'Ghost'], throughUnread: 'vendor/opaque.js' },
          ],
        },
      }),
    );

    expect(spread?.rungs).toEqual([{ depth: 1, reached: 1, moved: 0 }]);
    expect(spread?.throughUnread).toBe(1);
  });

  it('has no histogram at all when there was no diff to measure from', () => {
    expect(spreadOf(build({ reach: null }))).toBeNull();
  });
});
