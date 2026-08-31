import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BuildDetail, SubjectView } from '../review-types.js';
import { AlsoCarries, carriedWith } from './carried.js';

/**
 * What a press of Approve settles beyond the change it is filed under.
 *
 * A decision is taken on a subject and promotes the whole candidate image, so a
 * render holding this change and two others baselines all three. The hazard is
 * not the arithmetic, it is that the other two have pages and approve buttons of
 * their own which nobody pressed — and at a button drawn in three thousand shots
 * the batch is the only usable control and also the thing that hides this.
 *
 * The counting rule is `cause`: a container that reflowed is not a second change,
 * and listing it would put six framework wrappers on every render.
 */

function read(
  subject: string,
  moved?: readonly { component: string; bands: readonly string[]; cause: boolean }[],
): SubjectView {
  return {
    subject,
    verdict: 'changed',
    because: 'the rendered image differs',
    changedPixels: 100,
    regions: [],
    findings: [],
    decision: null,
    approvable: true,
    ...(moved === undefined ? {} : { moved }),
  } as SubjectView;
}

function build(subjects: readonly SubjectView[]): BuildDetail {
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
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
    subjects,
    notObserved: [],
    causes: [],
    variations: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: null,
    reach: null,
  };
}

/** The example's build 9, where `Button` shares four of its renders. */
const BUILD = build([
  read('story:button--primary', [{ component: 'Button', bands: ['token'], cause: true }]),
  read('story:product-card--sale', [
    { component: 'Button', bands: ['token'], cause: true },
    { component: 'Card', bands: ['geometry'], cause: false },
    { component: 'CardFooter', bands: ['a11y', 'content'], cause: true },
  ]),
  read('route/sneakers@1280', [
    { component: 'Button', bands: ['token'], cause: true },
    { component: 'CardFooter', bands: ['a11y'], cause: true },
    { component: 'LinkComponent', bands: ['geometry'], cause: true },
  ]),
  read('route/detail@390'),
]);

const WHERE = [
  'story:button--primary',
  'story:product-card--sale',
  'route/sneakers@1280',
  'route/detail@390',
];

describe('what else is in the picture a decision would promote', () => {
  it('names the other causes, widest first, and where each of them is', () => {
    const carrying = carriedWith(BUILD, 'Button', WHERE);

    expect(carrying.others).toEqual([
      {
        component: 'CardFooter',
        subjects: ['story:product-card--sale', 'route/sneakers@1280'],
      },
      { component: 'LinkComponent', subjects: ['route/sneakers@1280'] },
    ]);
  });

  it('does not count a container that only reflowed as a second change', () => {
    // `Card` moved in `story:product-card--sale` with `cause` false. Counting it
    // would put every framework wrapper on the warning.
    const carrying = carriedWith(BUILD, 'Button', WHERE);

    expect(carrying.others.map((each) => each.component)).not.toContain('Card');
  });

  it('separates a render carrying only this change from one nobody read', () => {
    const carrying = carriedWith(BUILD, 'Button', WHERE);

    expect(carrying.alone).toEqual(['story:button--primary']);
    expect(carrying.shared).toEqual(['story:product-card--sale', 'route/sneakers@1280']);
    expect(carrying.unread).toEqual(['route/detail@390']);
  });

  it('answers one render with the names in it', () => {
    const carrying = carriedWith(BUILD, 'Button', WHERE);

    expect(carrying.at('route/sneakers@1280')).toEqual(['CardFooter', 'LinkComponent']);
    expect(carrying.at('story:button--primary')).toEqual([]);
    // Not read is not empty, and the caller that marks a row must not be able to
    // tell them apart by this alone.
    expect(carrying.at('route/detail@390')).toEqual([]);
  });

  it('leaves out the change being decided, which is in every one of them', () => {
    expect(
      carriedWith(BUILD, 'CardFooter', ['story:product-card--sale']).others.map(
        (each) => each.component,
      ),
    ).toEqual(['Button']);
  });
});

describe('the warning over the approve button', () => {
  const markup = (component = 'Button', where = WHERE, changes = new Set(['CardFooter'])) =>
    renderToStaticMarkup(
      <AlsoCarries
        carrying={carriedWith(BUILD, component, where)}
        renders={where.length}
        build="9"
        changes={changes}
        go={() => {}}
      />,
    );

  it('says how many renders and what a press does to them', () => {
    const page = markup();

    expect(page).toContain('<strong>2 of 4 renders</strong> also carry');
    expect(page).toContain('approving here accepts those in the same renders');
  });

  it('links the ones with a page of their own so the instruction is actionable', () => {
    const page = markup();

    expect(page).toContain('href="/builds/9/changes/CardFooter"');
    expect(page).toContain('<strong>LinkComponent</strong>');
  });

  it('says how many renders nothing was read in rather than calling them clean', () => {
    expect(markup()).toContain('1 render compared against a baseline with no component hashes');
  });

  it('renders nothing when every render carries this change alone', () => {
    expect(markup('Button', ['story:button--primary'])).toBe('');
  });
});
