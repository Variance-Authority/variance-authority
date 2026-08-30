import { describe, expect, it } from 'vitest';
import type { BuildDetail, Placement, SubjectView } from '../review-types.js';
import { handedTo } from './handed.js';

/**
 * Separating a component's own edit from the prop a parent gave it.
 *
 * The graph and the numbers are the example's, because that is where the
 * complaint came from: one revision restyles `ui/button.tsx` and adds an
 * `aria-label` to the `Button` that `ProductCard` mounts, and the change page
 * folded both into *Button moved in what it announces, its layout and its style
 * values* over a byline naming `button.tsx`.
 *
 * Every case here is a way of getting that wrong. The evidence is a partition —
 * the band moved in every render the parent draws and in none of the others —
 * and each thing that makes a partition unavailable has its own silence: no
 * render where the band held still, no reach walk, an overlap, a coincidence.
 */

const CENSUS_WITHIN: Readonly<Record<string, readonly string[]>> = {
  Button: ['Card'],
  Card: ['CartCard', 'ProductCard'],
};

const CENSUS: readonly Placement[] = [
  // The button is drawn in the two cards, in the detail route, and in stories of
  // its own. The stories are what make the answer decidable.
  place('Button', [
    'route/detail@1280',
    'route/sneakers@1280',
    'story:button--primary',
    'story:button--small',
    'story:cart-card--item',
    'story:product-card--sale',
  ]),
  place('ProductCard', ['route/sneakers@1280', 'story:product-card--sale'], {
    renders: ['Button'],
  }),
  place('CartCard', ['story:cart-card--item'], { renders: ['Button'] }),
  place('Card', ['route/sneakers@1280', 'story:cart-card--item', 'story:product-card--sale'], {
    renders: ['Button'],
  }),
];

function place(
  component: string,
  subjects: readonly string[],
  over: Partial<Placement> = {},
): Placement {
  const within = CENSUS_WITHIN[component] ?? [];
  return { component, subjects, within, createdBy: [], renders: [], ...over };
}

/** One render, and what the hashes said the button did in it. */
function read(subject: string, bands: readonly string[] | null): SubjectView {
  return {
    subject,
    verdict: bands === null ? 'unchanged' : 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 1,
    regions: [],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    // `null` is a render nobody read. `[]` is a render that was read and held
    // still — which is the control group, and the whole claim rests on it.
    ...(bands === null ? {} : { moved: [{ component: 'Button', bands, cause: true }] }),
  };
}

const READ: readonly SubjectView[] = [
  read('route/detail@1280', ['token']),
  read('route/sneakers@1280', ['a11y', 'geometry', 'token']),
  read('story:button--primary', ['token']),
  read('story:button--small', ['geometry', 'token']),
  read('story:cart-card--item', ['geometry', 'token']),
  read('story:product-card--sale', ['a11y', 'geometry', 'token']),
];

function build(over: Partial<BuildDetail> = {}): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '9',
    commit: 'a'.repeat(40),
    at: '2026-08-30T00:00:00.000Z',
    identity: { engine: 'chromium' } as BuildDetail['identity'],
    retention: 'durable',
    verdicts: { changed: 6 } as BuildDetail['verdicts'],
    decided: 0,
    pending: 6,
    coverage: { stated: true, failed: 0, excluded: 0 },
    subjects: READ,
    notObserved: [],
    causes: [],
    variations: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: CENSUS,
    reach: {
      against: 'main',
      changed: ['app/src/components/ProductCard.tsx', 'app/src/components/ui/button.tsx'],
      components: [
        { component: 'Button', trail: ['app/src/components/ui/button.tsx', 'Button'] },
        // Reached through the button it also draws, and the wrong answer: it
        // draws one of the renders the label moved in and none of the rest.
        { component: 'CartCard', trail: ['app/src/components/ui/button.tsx', 'CartCard'] },
        { component: 'ProductCard', trail: ['app/src/components/ProductCard.tsx', 'ProductCard'] },
      ],
    },
    ...over,
  };
}

describe('the band that came from a parent, not from this component', () => {
  it('hands the label to the card that mounts it, and keeps the restyle here', () => {
    expect(handedTo(build())('Button')).toEqual([
      { band: 'a11y', holders: ['ProductCard'], moved: 2, held: 4 },
    ]);
  });

  it('refuses a band that also moved where no candidate draws it', () => {
    // `geometry` moved in `button--small`, which no card draws. A rule that
    // asked only *does the parent draw every render it moved in* would still
    // reject it; a rule that asked *some* would file the button's own size
    // change under the card.
    const only = handedTo(build())('Button').map((each) => each.band);

    expect(only).not.toContain('geometry');
  });

  it('refuses a band that moved everywhere, which every ancestor covers', () => {
    // `token` is the restyle: it moved in all six. With no render where it held
    // still there is nothing to partition, and every enclosure trivially draws
    // *everywhere it moved*. This is the case that would hand a component its
    // own edit.
    expect(handedTo(build())('Button').map((each) => each.band)).not.toContain('token');
  });

  it('says nothing when the suite has no render that would have told them apart', () => {
    // `CartCard` draws one render, the button moved in it, and there is no
    // second reading. Probably a prop and unprovable, and *probably* is not
    // what this prints.
    const narrow = build({
      composition: [
        place('Button', ['story:cart-card--item']),
        place('CartCard', ['story:cart-card--item'], { renders: ['Button'] }),
      ],
      subjects: [read('story:cart-card--item', ['a11y', 'token'])],
    });

    expect(handedTo(narrow)('Button')).toEqual([]);
  });

  it('will not take a render nobody read as one where the band held still', () => {
    // Absent is not equal. With the two card renders unread, `a11y` moved in
    // one render and *held still* in three that were never compared — and the
    // partition would name whichever ancestor happens to draw the rest.
    const unread = build({
      subjects: READ.map((subject) =>
        subject.subject.includes('product-card') || subject.subject.includes('sneakers')
          ? read(subject.subject, null)
          : subject,
      ),
    });

    expect(handedTo(unread)('Button')).toEqual([]);
  });

  it('will not name a parent the commit never touched', () => {
    // `Card` draws exactly the renders `a11y` moved in plus the cart, so it is
    // one render away from fitting — and if it fitted, an untouched container
    // would be handed a change no file of its could have caused.
    const coincidence = build({
      reach: {
        against: 'main',
        changed: ['app/src/components/ui/button.tsx'],
        components: [{ component: 'Button', trail: ['app/src/components/ui/button.tsx', 'Button'] }],
      },
    });

    expect(handedTo(coincidence)('Button')).toEqual([]);
  });

  it('keeps *no diff was read* from becoming a finding on every component', () => {
    expect(handedTo(build({ reach: null }))('Button')).toEqual([]);
    expect(
      handedTo(build({ reach: { against: 'main', changed: [], components: [], whole: 'no base' } }))(
        'Button',
      ),
    ).toEqual([]);
  });

  it('answers nothing for a name no census placed, and for no census at all', () => {
    expect(handedTo(build())('Ghost')).toEqual([]);
    expect(handedTo(build({ composition: null }))('Button')).toEqual([]);
  });

  it('terminates on a cycle, which a render tree folded over a suite contains', () => {
    const looped = build({
      composition: [
        place('Button', ['route/sneakers@1280', 'story:button--primary'], { within: ['Menu'] }),
        place('Menu', ['route/sneakers@1280'], { within: ['Button'] }),
      ],
      subjects: [
        read('route/sneakers@1280', ['a11y']),
        read('story:button--primary', []),
      ],
    });

    // `Menu` fits the partition and the commit reaches nothing, so the answer is
    // empty — what is asserted is that there is an answer at all.
    expect(handedTo(looped)('Button')).toEqual([]);
  });
});
