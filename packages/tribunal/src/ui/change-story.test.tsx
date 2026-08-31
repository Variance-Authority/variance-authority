import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { SubjectView } from '../review-types.js';
import { Shapes } from './change-story.js';
import type { Appearance, Origin } from './grouping.js';

/**
 * What the divided batch says on the page, as distinct from how it is derived.
 *
 * [`parted.test.ts`](./parted.test.ts) settles the grouping. What is asserted
 * here is that the groups reach the reviewer *named* — the renders in each, and
 * the flag that takes exactly that set. A section that printed two counts would
 * tell somebody the batch is divided and leave them to find the seam.
 */

function appearance(subject: string, pixels: number, shape?: string): Appearance {
  return {
    subject: { subject, decision: null } as SubjectView,
    pixels,
    alongside: [],
    ...(shape === undefined ? {} : { shape }),
  };
}

function shapes(appearances: readonly Appearance[]): string {
  const origin: Origin = {
    component: 'Button',
    pixels: appearances.reduce((total, each) => total + each.pixels, 0),
    appearances,
  };

  return renderToStaticMarkup(<Shapes origin={origin} />);
}

describe('where one change stopped agreeing with itself', () => {
  it('names the renders in each group, not just how many there are', () => {
    const page = shapes([
      appearance('route/detail@1280', 6418, 'f1'),
      appearance('route/detail@390', 6418, 'f1'),
      appearance('story:button--primary', 3431, 'f2'),
    ]);

    expect(page).toContain('2 shapes over 3 renders');
    expect(page).toContain('route/detail@1280, route/detail@390');
    expect(page).toContain('story:button--primary');
  });

  it('prints the span when the group is not one size, and the size when it is', () => {
    const page = shapes([
      appearance('a', 6418, 'f1'),
      appearance('b', 6418, 'f1'),
      appearance('c', 3431, 'f2'),
      appearance('d', 3742, 'f2'),
    ]);

    expect(page).toContain('6,418 px');
    expect(page).toContain('3,431–3,742 px');
  });

  it('labels a group by the name its renders share', () => {
    const page = shapes([
      appearance('route/detail@1280', 6418, 'f1'),
      appearance('route/detail@390', 6418, 'f1'),
      appearance('story:button--primary', 3431, 'f2'),
      appearance('story:card--sale', 3431, 'f2'),
    ]);

    expect(page).toContain('>route/detail<');
    expect(page).toContain('>story<');
  });

  it('gives each group the flag that takes exactly it', () => {
    // The point of printing the shape at all. A reviewer who agrees with one
    // group and not the other has a command for the half they accept.
    const page = shapes([appearance('a', 900, 'f1'), appearance('b', 400, 'f2')]);

    expect(page).toContain('--shape f1');
    expect(page).toContain('--shape f2');
  });

  it('reports agreement as a sentence, and offers the whole set to the CLI', () => {
    const page = shapes([appearance('a', 100, 'f1'), appearance('b', 100, 'f1')]);

    expect(page).toContain('The same difference in every one of the 2 renders');
    expect(page).toContain('variance accept --shape f1');
  });

  it('says a render matched nothing rather than folding it in with the rest', () => {
    // Two renders that recorded no shape have not been found to agree. Listed
    // under one heading they would read as a third finding nothing measured.
    const page = shapes([
      appearance('a', 900, 'f1'),
      appearance('b', 900, 'f1'),
      appearance('c', 0),
    ]);

    expect(page).toContain('1 render recorded no shape');
    expect(page).toContain('c');
  });

  it('draws nothing when no render recorded a shape at all', () => {
    // Not an empty section with a heading over it. Nothing here was measured,
    // and a heading reading *0 shapes* is a finding about the baseline.
    expect(shapes([appearance('a', 0), appearance('b', 0)])).toBe('');
  });
});
