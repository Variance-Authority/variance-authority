import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { MovementView, SubjectView } from '../review-types.js';
import type { Appearance, Origin } from './grouping.js';
import { HeldStill, controlsFor } from './control.js';

/**
 * The renders that did not move, which is the arm the page never had.
 *
 * The failure this replaced was not a missing section, it was a wrong one: the
 * run built the control group by excluding the renders it *reported* moving, and
 * a report is the causal regions only — so a component whose digests moved inside
 * a box the pixels named for something else came back as a render where it held
 * still. On the example that was every entry, all thirty-two of them, and the
 * page would have carried *held still* and *its hashes moved here* about the same
 * three renders.
 *
 * What is asserted here is the reading and its refusals: an empty list is never
 * drawn as a finding, because empty has two causes that point opposite ways, and
 * a movement that is absent is never counted as a render without a control.
 */

function appearance(subject: string, held?: readonly string[], compared?: number): Appearance {
  const movement: MovementView = {
    subject,
    component: 'Button',
    cause: 'edited',
    because: '`app/src/components/ui/button.tsx` is in the change set',
    bands: [],
    held: held ?? [],
    file: 'app/src/components/ui/button.tsx',
    ...(compared === undefined ? {} : { compared }),
  };

  return {
    subject: { subject, verdict: 'changed', decision: null, approvable: true } as SubjectView,
    pixels: 100,
    ...(held === undefined ? {} : { movement }),
  } as Appearance;
}

function origin(appearances: readonly Appearance[]): Origin {
  return { component: 'Button', pixels: 100, appearances } as Origin;
}

describe('the control group a change is measured against', () => {
  it('names every render that held, once, across the appearances that had one', () => {
    const controls = controlsFor(
      origin([
        appearance('story:product-card--sale', ['route/cart@1280', 'story:button--outline']),
        appearance('story:product-card--control', ['route/cart@1280', 'story:button--small']),
      ]),
    );

    expect(controls.held).toEqual([
      'route/cart@1280',
      'story:button--outline',
      'story:button--small',
    ]);
    expect(controls.of).toBe(2);
    expect(controls.renders).toBe(2);
  });

  it('says nothing escaped when a real comparison held nowhere', () => {
    // The example's whole answer. Every candidate control for `Button` moved, and
    // a page that stayed silent because the list is empty would drop the one
    // measurement the run made.
    const markup = renderToStaticMarkup(
      <HeldStill
        controls={controlsFor(origin([appearance('story:product-card--sale', [], 4)]))}
        build="9"
        go={() => {}}
      />,
    );

    expect(markup).toContain('Held nowhere');
    expect(markup).toContain('4 other renders');
  });

  it('draws nothing when the empty list has no denominator to read it against', () => {
    // A build ingested before `compared` was carried. Without it, *nothing to
    // compare against* and *compared and moved in all of them* are the same empty
    // list, and printing either is a guess with a fifty-fifty chance.
    const controls = controlsFor(origin([appearance('story:product-card--sale', [])]));

    expect(controls.held).toEqual([]);
    expect(controls.compared).toBeUndefined();
    expect(renderToStaticMarkup(<HeldStill controls={controls} build="9" go={() => {}} />)).toBe('');
  });

  it('stays silent when the component renders nowhere else with these props', () => {
    const controls = controlsFor(origin([appearance('story:product-card--sale', [], 0)]));

    expect(renderToStaticMarkup(<HeldStill controls={controls} build="9" go={() => {}} />)).toBe('');
  });

  it('takes the widest pool rather than adding the appearances up', () => {
    // The pools overlap: the same four other renders are the comparison for each
    // appearance. Summed, one component in three renders reports twelve.
    const controls = controlsFor(
      origin([
        appearance('story:product-card--sale', [], 4),
        appearance('story:product-card--control', [], 4),
      ]),
    );

    expect(controls.compared).toBe(4);
  });

  it('does not count a render whose movement was never recorded', () => {
    // A build ingested before attributions were carried has no movement at all.
    // Counted as a render without a control, it would report a missing input as
    // a narrower control group than the run actually found.
    const controls = controlsFor(
      origin([appearance('story:product-card--sale', ['route/cart@1280']), appearance('route/home@390')]),
    );

    expect(controls.of).toBe(1);
    expect(controls.renders).toBe(2);
  });

  it('says which renders the control covers when it does not cover them all', () => {
    const markup = renderToStaticMarkup(
      <HeldStill
        controls={controlsFor(
          origin([
            appearance('story:product-card--sale', ['route/cart@1280']),
            appearance('story:product-card--control', []),
          ]),
        )}
        build="9"
        go={() => {}}
      />,
    );

    expect(markup).toContain('a control for 1 of 2 renders');
  });

  it('is silent about coverage when every render of the change had one', () => {
    const markup = renderToStaticMarkup(
      <HeldStill
        controls={controlsFor(origin([appearance('story:product-card--sale', ['route/cart@1280'])]))}
        build="9"
        go={() => {}}
      />,
    );

    expect(markup).toContain('Held still');
    expect(markup).toContain('route/cart@1280');
    expect(markup).not.toContain('a control for');
  });
});
