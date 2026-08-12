// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import {
  attributeMovement,
  composeSubjects,
  componentInstances,
  normalize,
  type SemanticSnapshot,
  type SubjectComposition,
  type Viewport,
} from '@variance-authority/core';
import { collect } from '@variance-authority/dom';
import { portalContentOf, provenanceOf } from '@variance-authority/react';
import { renderStory } from './render.js';
import { buildSourceIndex } from './source-index.js';
import { STORIES } from './stories.js';

/**
 * The suite compared to *itself*, measured on a real one.
 *
 * Every other measurement in this repository is a subject against its baseline.
 * This is the other axis: fifteen stories at one commit, joined on what they have
 * in common, with no baseline anywhere in it.
 *
 * The numbers below are asserted rather than described because they are the
 * claim. [`composition.md`](../../../docs/composition.md) says a design-system
 * story and the page that mounts the same component can reach the same digest,
 * that every component standing over an element holds a boundary there, and
 * that this suite produces no divergences. If any of that stops being true the
 * document is wrong and this is where it is found out.
 */

const VIEWPORT: Viewport = { width: 1024, height: 768, deviceScaleFactor: 1, colorScheme: 'light' };

function snapshotOf(storyId: string): SemanticSnapshot {
  document.head.innerHTML = '';
  document.body.innerHTML = '';
  const container = document.createElement('div');
  document.body.appendChild(container);

  try {
    renderStory(container, storyId);

    return normalize(
      collect(container, {
        subject: { id: storyId, kind: 'story' },
        viewport: VIEWPORT,
        engine: 'jsdom@composition',
        fonts: ['system/400/normal/composition'],
        provenanceOf,
        portalsOf: portalContentOf,
      }),
    );
  } finally {
    container.remove();
  }
}

/**
 * The whole suite, collected once.
 *
 * Once rather than per-`describe`, because the point of the phase is that it is a
 * fold over one run: fifteen collections that each saw the others' output would
 * be measuring something no `variance run` ever produces.
 */
const SUITE: readonly SubjectComposition[] = STORIES.map((story) => ({
  subject: story.id,
  instances: componentInstances(snapshotOf(story.id)),
}));

const COMPOSITION = composeSubjects(SUITE);

const entry = (name: string) =>
  COMPOSITION.components.find((each) => each.component === name);

describe('the suite as one graph', () => {
  it('finds every component in the ownership stack, not only the innermost', () => {
    // Twelve, which is every component this application has. `TodoApp`,
    // `TodoHeader`, `TodoList` and `TodoFooter` author no DOM node of their own —
    // each returns other components — and they are still boundaries, because a
    // node stands inside every component above it and not only the nearest one.
    // They are also the four files somebody actually edits.
    expect(COMPOSITION.components.map((each) => each.component)).toEqual([
      'Button',
      'Card',
      'Chip',
      'Stack',
      'Text',
      'TextField',
      'TodoApp',
      'TodoFooter',
      'TodoHeader',
      'TodoItem',
      'TodoList',
      'Toggle',
    ]);
  });

  it('joins a design-system story to the pages that mount the same component', () => {
    // Nine subjects for one component, three of which exist to show it and six of
    // which merely contain it. That split is the whole premise: an example *is* a
    // component at a boundary, and the same component turns up inside larger ones.
    expect(entry('Button')?.subjects).toEqual([
      'ds/button--default',
      'ds/button--primary',
      'ds/button--danger',
      'page/todos--empty',
      'page/todos--populated',
      'page/todos--active-filter',
      'page/todos--completed-filter',
      'page/todos--drafting',
      'page/footer--counts',
    ]);
    expect(entry('Button')?.instances).toBe(9);
  });

  it('names the story that exists to show a component, and admits when there is none', () => {
    expect(entry('Button')?.examples).toEqual([
      'ds/button--default',
      'ds/button--primary',
      'ds/button--danger',
    ]);

    // Twenty-one chips across seven subjects and not one subject whose shallowest
    // boundary is a `Chip`. Empty is a real answer, and it is the gap a reviewer
    // looks for — this component is only ever seen through something else.
    expect(entry('Chip')?.instances).toBe(21);
    expect(entry('Chip')?.examples).toEqual([]);
  });

  it('gives a wrapped story to the wrapper, which is what the story is an example of', () => {
    // Three design-system stories open with a `Stack` laying out the thing they
    // exist to show. The shallowest boundary is the wrapper, so that is whose
    // example they are — and `Chip`, `Text` and `Toggle` each have none.
    expect(entry('Stack')?.examples).toEqual([
      'ds/text--scale',
      'ds/toggle--states',
      'ds/chip--group',
    ]);
    for (const name of ['Chip', 'Text', 'Toggle']) {
      expect(entry(name)?.examples).toEqual([]);
    }
  });

  it('records the graph downwards as edges between boundaries', () => {
    expect(entry('TodoApp')?.renders).toEqual(['Card']);
    expect(entry('Card')?.renders).toEqual(['Stack', 'Text']);
    expect(entry('TodoItem')?.renders).toEqual(['Stack']);
    expect(entry('Stack')?.renders).toEqual([
      'Button',
      'Chip',
      'Text',
      'TextField',
      'TodoFooter',
      'TodoHeader',
      'TodoItem',
      'TodoList',
      'Toggle',
    ]);
  });
});

describe('the two edges upwards, which are not the same edge', () => {
  /**
   * The measurement that made `createdBy` a first-class axis rather than a
   * tie-break inside the attribution ladder.
   */

  it('opens several boundaries at one element when several components stand over it', () => {
    // `TodoApp` returns a `Card` which returns a `Stack`: three components, one
    // `div`. All three hold a boundary there, nested in that order, so the two
    // outer ones have a hash and an example of their own.
    expect(entry('TodoApp')?.instances).toBe(5);
    expect(entry('TodoApp')?.within).toEqual(['(unattributed)']);
    expect(entry('Card')?.within).toEqual(['(unattributed)', 'TodoApp']);
    expect(entry('Card')?.createdBy).toEqual(['TodoApp']);
  });

  it('says where a boundary sits and, separately, who mounted it', () => {
    // Every chip sits inside a `Stack` — a presentational wrapper that knows
    // nothing about chips — and every chip was written by `TodoFooter`.
    expect(entry('Chip')?.within).toEqual(['Stack']);
    expect(entry('Chip')?.createdBy).toEqual(['TodoFooter']);

    expect(entry('Toggle')?.within).toEqual(['Stack']);
    expect(entry('Toggle')?.createdBy).toEqual(['TodoItem']);

    // `(unattributed)` is the subject root's parent: a boundary directly under the
    // container has nothing above it, which is recorded rather than dropped.
    expect(entry('TextField')?.within).toEqual(['(unattributed)', 'Stack']);
    expect(entry('TextField')?.createdBy).toEqual(['TodoHeader']);
  });

  it('reaches a caller on the edge that mounts, where the edge that encloses reaches a wrapper', () => {
    // Every name on the mounting edge is a component that writes elements. The
    // enclosing edge adds `Stack` and `Card`, which are the two components a
    // reviewer never edits — so a ladder consulting only enclosure lands on a
    // layout primitive for `Chip`, `Toggle`, `Text` and `TextField` alike.
    const mounted = new Set(COMPOSITION.components.flatMap((each) => each.createdBy));
    const enclosing = new Set(COMPOSITION.components.flatMap((each) => each.within));

    expect([...mounted].sort()).toEqual([
      'TodoApp',
      'TodoFooter',
      'TodoHeader',
      'TodoItem',
      'TodoList',
    ]);
    expect([...enclosing].sort()).toEqual([
      '(unattributed)',
      'Card',
      'Stack',
      'TodoApp',
      'TodoFooter',
      'TodoHeader',
      'TodoItem',
      'TodoList',
    ]);
  });
});

describe('the echoes — the same rendering in two subjects', () => {
  it('crosses a subject boundary in every echo it reports', () => {
    // An echo inside one subject is a repeated element, not a joined dot.
    expect(COMPOSITION.echoes.length).toBe(26);
    expect(
      COMPOSITION.echoes.every(
        (echo) => new Set(echo.sites.map((site) => site.subject)).size >= 2,
      ),
    ).toBe(true);
  });

  it('joins the chip story to four pages, byte for byte', () => {
    const echo = COMPOSITION.echoes.find((each) =>
      each.sites.some((site) => site.subject === 'ds/chip--group'),
    );

    expect(echo?.component).toBe('Chip');
    expect([...new Set(echo?.sites.map((site) => site.subject) ?? [])]).toEqual([
      'ds/chip--group',
      'page/todos--empty',
      'page/todos--populated',
      'page/todos--drafting',
      'page/footer--counts',
    ]);
  });

  it('sends a reader to the narrow example when the suite has one', () => {
    const item = COMPOSITION.echoes.find(
      (each) => each.component === 'TodoItem' && each.example !== undefined,
    );

    expect(item?.example).toBe('page/item--done');
    expect([...new Set(item?.sites.map((site) => site.subject) ?? [])]).toContain(
      'page/todos--populated',
    );
  });

  it('reports no echo at all for the three button stories, which is the finding', () => {
    // Nine buttons, four renderings, and the only echo among them is the six
    // identical "Clear completed" buttons in the pages. Not one of the three
    // design-system button stories renders anything the application also renders:
    // the stories show `default`, `primary` and `danger`, and the application
    // mounts a fourth thing none of them covers.
    //
    // A join that reported this as a connection would be lying. The absence is the
    // useful output — three examples guarding a component whose real usage they
    // never touch.
    const buttons = COMPOSITION.echoes.filter((each) => each.component === 'Button');

    expect(buttons.length).toBe(1);
    expect(buttons[0]?.example).toBeUndefined();
    expect(
      buttons[0]?.sites.every((site) => site.subject.startsWith('page/')),
    ).toBe(true);
  });
});

describe('the divergences — one input, two renderings, one commit', () => {
  it('finds none, because every pair it could have reported is explainable', () => {
    // Zero is the correct answer for a suite where nothing renders two ways from
    // one input, and an empty list here is worth more than a populated one. The
    // three shapes that reach `divergencesOf` and are refused by it are listed in
    // ADR-0034; each is an artifact of a props digest excluding `children`.
    expect(COMPOSITION.divergences).toEqual([]);
  });

  it('still has components whose renderings outnumber their props classes', () => {
    // The refusals are not a blanket "never report". `Card` really does produce
    // two renderings under one props digest — it is `children` that differs, which
    // is why this pair is refused and not why the check is disabled.
    expect(entry('Card')?.classes.length).toBe(1);
    expect(entry('Card')?.classes.reduce((n, group) => n + group.renderings.length, 0)).toBe(2);
  });
});

describe('attribution over the real graph, with the real source index', () => {
  const source = buildSourceIndex();
  const declaredIn = new Map(
    Object.entries(source).map(([component, refs]) => [
      component,
      [...new Set(refs.map((ref) => ref.file))],
    ]),
  );

  it('sends a reviewer to the file, when the run asked what changed', () => {
    const attribution = attributeMovement(
      [{ subject: 'page/todos--populated', component: 'Button', bands: ['content'] }],
      COMPOSITION,
      { changed: ['src/ds/components.tsx'], declaredIn },
    );

    expect(attribution.movements[0]?.cause).toBe('edited');
    expect(attribution.movements[0]?.file).toBe('src/ds/components.tsx');
    expect(attribution.flakes).toEqual([]);
    expect(attribution.suspects).toEqual([]);
  });

  it('connects an edit to the caller with the chips that edit moved', () => {
    // `src/app/todo.tsx` declares `TodoFooter` and does not declare `Chip`. The
    // chips moved; their own file is untouched; the component they *sit inside* is
    // `Stack`, which is untouched too. Only the mounting edge reaches the file
    // somebody edited — five unexplained movements, or one caller.
    expect(declaredIn.get('Chip')).toEqual(['src/ds/components.tsx']);
    expect(declaredIn.get('TodoFooter')).toEqual(['src/app/todo.tsx']);
    expect(entry('Chip')?.within.some((name) => declaredIn.get(name)?.includes('src/app/todo.tsx')))
      .toBe(false);

    const attribution = attributeMovement(
      [
        { subject: 'page/todos--populated', component: 'Chip', bands: ['content'] },
        { subject: 'page/footer--counts', component: 'Chip', bands: ['content'] },
      ],
      COMPOSITION,
      { changed: ['src/app/todo.tsx'], declaredIn },
    );

    expect(attribution.movements.map((movement) => movement.cause)).toEqual([
      'upstream',
      'upstream',
    ]);
    expect(attribution.movements[0]?.upstream).toBe('TodoFooter');
    expect(attribution.movements[0]?.alsoIn).toEqual(['page/footer--counts']);
    expect(attribution.suspects).toEqual([]);
  });

  it('shortlists a movement the change set cannot explain, with its control group', () => {
    // `src/tokens/foundation.ts` declares no component in this suite, so nothing on
    // the ladder fires and the movement lands where it should: unexplained, and on
    // the shortlist a second reading is spent on.
    const attribution = attributeMovement(
      [{ subject: 'page/todos--populated', component: 'Chip', bands: ['content'] }],
      COMPOSITION,
      { changed: ['src/tokens/foundation.ts'], declaredIn },
    );

    const [suspect] = attribution.suspects;

    expect(suspect?.cause).toBe('unexplained');
    // The stable states to refer to: the same chip, same props, rendered in other
    // subjects of this same run and not reported moving in any of them.
    expect(suspect?.held.length).toBeGreaterThan(0);
    expect(suspect?.because).toContain('held in');
    expect(new Set(suspect?.held.map((site) => site.subject))).not.toContain(
      'page/todos--populated',
    );
  });

  it('calls it a flake only once the subject has failed to read the same way twice', () => {
    const moved = [{ subject: 'page/todos--populated', component: 'Chip', bands: ['content'] }];
    const evidence = { changed: ['src/tokens/foundation.ts'], declaredIn };

    expect(attributeMovement(moved, COMPOSITION, evidence).flakes).toEqual([]);

    const withSecondReading = attributeMovement(moved, COMPOSITION, {
      ...evidence,
      unstable: new Set(['page/todos--populated']),
    });

    expect(withSecondReading.flakes.map((movement) => movement.component)).toEqual(['Chip']);
    expect(withSecondReading.suspects).toEqual([]);
  });
});
