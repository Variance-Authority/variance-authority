import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BuildDetail, ReachView, SubjectView } from '../review-types.js';
import { OutcomeMapView, outcomeOf } from './outcome.js';

/**
 * The map, held to the four claims that make it worth drawing.
 *
 * Every one of them fails silently. A file filed under *the cause* on the strength
 * of a render it merely appeared on reads as an attribution and is not one; a file
 * whose components nothing renders, filed under *nothing moved*, hides a coverage
 * hole behind a reassuring sentence; a left column drawn over a diff the store
 * refused to attribute reads as a commit that reaches nothing. In each case the
 * page reads correctly and says the wrong thing, which is why these are asserted
 * rather than looked at.
 */

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

function caused(component: string): SubjectView['regions'][number] {
  return { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, component };
}

function build(subjects: readonly SubjectView[], reach: ReachView | null): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '6',
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
    reach,
  };
}

const BUTTON = 'app/src/components/ui/button.tsx';
const NAV = 'app/src/components/MainNav.tsx';

describe('a file is credited with what it caused, and never with what it was near', () => {
  it('calls a file the cause only where a region names a component it reaches', () => {
    const map = outcomeOf(
      build(
        [
          subject({ subject: 'story:button--primary', regions: [caused('Button')] }),
          // The nav is on this screen and the screen moved. Nothing says the nav
          // moved it, and the whole point of the semantic tier is that this stays
          // an observation rather than becoming an attribution.
          subject({ subject: 'route/home', regions: [caused('Button')] }),
        ],
        {
          against: 'HEAD~1',
          changed: [BUTTON, NAV],
          components: [
            { component: 'Button', trail: [BUTTON, 'Button'] },
            { component: 'MainNav', trail: [NAV, 'MainNav'] },
          ],
          subjects: {
            'story:button--primary': { reached: true, through: ['Button'], because: 'reached' },
            'route/home': { reached: true, through: ['Button', 'MainNav'], because: 'reached' },
          },
        },
      ),
    );

    expect(map?.edits.map((edit) => [edit.file, edit.effect, edit.caused])).toEqual([
      [BUTTON, 'caused', 2],
      [NAV, 'present', 0],
    ]);
  });

  it('counts a render once for a file, however many of its components draw it', () => {
    // `Button` and `Comp` both come out of button.tsx and both appear on the same
    // screen. That is one render the file caused, and a total summed per arrival
    // would report two — which is how a three-file commit comes to claim more
    // changed renders than the suite contains.
    const map = outcomeOf(
      build([subject({ subject: 'route/home', regions: [caused('Button'), caused('Comp')] })], {
        against: 'HEAD~1',
        changed: [BUTTON],
        components: [
          { component: 'Button', trail: [BUTTON, 'Button'] },
          { component: 'Comp', trail: [BUTTON, 'Comp'] },
        ],
        subjects: {
          'route/home': { reached: true, through: ['Button', 'Comp'], because: 'reached' },
        },
      }),
    );

    expect(map?.edits[0]?.caused).toBe(1);
  });
});

describe('the two findings a comparison tool cannot reach', () => {
  const graph: ReachView = {
    against: 'HEAD~1',
    changed: [BUTTON],
    components: [{ component: 'Button', trail: [BUTTON, 'Button'] }],
    subjects: {
      'story:button--outline': { reached: true, through: ['Button'], because: 'reached' },
    },
  };

  it('says so when everything a file reaches held still', () => {
    // The author believed they were restyling this. Every render carrying it
    // agrees with its baseline, and no comparison tool says a word about a green
    // subject — so if it is not said here it is not said anywhere.
    const map = outcomeOf(
      build([subject({ subject: 'story:button--outline', verdict: 'unchanged', changedPixels: 0 })], graph),
    );

    expect(map?.edits[0]?.effect).toBe('still');
  });

  it('separates a component nothing renders from one whose renders held still', () => {
    // Both are quiet. One is a surface that did not move and the other is a
    // surface nobody photographs, and a map that called them both *nothing moved*
    // would file a coverage hole under working as intended.
    const map = outcomeOf(build([], { ...graph, subjects: {} }));

    expect(map?.edits[0]?.effect).toBe('uncaptured');
  });

  it('names a file the graph carries nowhere rather than leaving it off the map', () => {
    const map = outcomeOf(
      build([], { against: 'HEAD~1', changed: ['app/src/server/db.ts'], components: [], subjects: {} }),
    );

    expect(map?.edits.map((edit) => edit.effect)).toEqual(['unreaching']);
  });
});

describe('the map is not drawn where the diff was not attributed', () => {
  it('draws nothing at all when the diff was not attributed', () => {
    // `whole` is the store's refusal. A left column of files with no edges under
    // them reads as *this commit reaches none of your subjects*, which is a
    // sentence somebody merges on.
    const map = outcomeOf(
      build([], {
        against: 'HEAD~1',
        changed: [BUTTON],
        components: [],
        whole: 'the diff named a file the graph does not hold',
      }),
    );

    expect(map).toBeNull();
  });

  it('draws nothing when the run carried no diff', () => {
    expect(outcomeOf(build([subject()], null))).toBeNull();
  });
});

describe('what the row says out loud', () => {
  it('reports the still renders even when they are the only ones', () => {
    const markup = renderToStaticMarkup(
      <OutcomeMapView
        build={build([subject({ subject: 'story:a', verdict: 'unchanged', changedPixels: 0 })], {
          against: 'HEAD~1',
          changed: [BUTTON],
          components: [{ component: 'Button', trail: [BUTTON, 'Button'] }],
          subjects: { 'story:a': { reached: true, through: ['Button'], because: 'reached' } },
        })}
      />,
    );

    expect(markup).toContain('1 still');
    expect(markup).toContain('nothing it reaches moved');
  });

  it('says a component is drawn nowhere rather than showing an empty bar', () => {
    // An empty track and a track of one colour are different findings and would
    // be a pixel apart at this size.
    const markup = renderToStaticMarkup(
      <OutcomeMapView
        build={build([], {
          against: 'HEAD~1',
          changed: [BUTTON],
          components: [{ component: 'Button', trail: [BUTTON, 'Button'] }],
          subjects: {},
        })}
      />,
    );

    expect(markup).toContain('no render draws it');
    expect(markup).not.toContain('va-bar-part');
  });

  it('prints the chain when the commit arrives through another file', () => {
    const markup = renderToStaticMarkup(
      <OutcomeMapView
        build={build([], {
          against: 'HEAD~1',
          changed: [BUTTON],
          components: [
            { component: 'CartCard', trail: [BUTTON, 'app/src/components/CartCard.tsx', 'CartCard'] },
          ],
          subjects: {},
        })}
      />,
    );

    expect(markup).toContain('through app/src/components/CartCard.tsx');
  });
});
