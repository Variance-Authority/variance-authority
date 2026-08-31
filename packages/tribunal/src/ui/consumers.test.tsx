import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { BuildDetail, Placement, SubjectView } from '../review-types.js';
import { Consumers, consumersOf } from './consumers.js';

/**
 * The reading that answers *and does everything using it still look right*.
 *
 * Every case here is one of the two mistakes. The first is calling a consumer
 * changed: a card whose row grew because the button inside it got taller is the
 * consequence a reviewer came to check, and putting it on an alarm list beside a
 * component that did something of its own destroys the only distinction on the
 * page. The second is calling it fine: a render nobody compared hashes in is not
 * a render where anything held still, and counting it as one is how *4 of 4 held
 * still* gets printed over a build that measured none of them.
 *
 * The numbers come from the example's own build 9, where `Button` is drawn by
 * five components and each of the four states occurs.
 */

const CENSUS: readonly Placement[] = [
  place('Button', ['detail@1280', 'detail@390', 'grid@1280', 'nav@1280', 'cart@1280'], {
    within: ['Card', 'LinkComponent', 'EmptyCart'],
  }),
  place('Card', ['detail@1280', 'detail@390', 'grid@1280']),
  place('LinkComponent', ['nav@1280']),
  place('EmptyCart', ['cart@1280']),
  // Draws it nowhere, which is what makes the shared-render constraint do work.
  place('Sidebar', ['sidebar@1280']),
];

function place(
  component: string,
  subjects: readonly string[],
  over: Partial<Placement> = {},
): Placement {
  return { component, subjects, within: [], createdBy: [], renders: [], ...over };
}

/** `undefined` bands is *nothing compared hashes here*, and is not *held still*. */
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
    movements: [],
    composition: CENSUS,
    reach: null,
    ...over,
  };
}

/** The example's shape: Card reflows, LinkComponent moves, EmptyCart holds. */
const SUBJECTS: readonly SubjectView[] = [
  read('detail@1280', [{ component: 'Card', bands: ['geometry'], cause: false }]),
  read('detail@390', []),
  read('grid@1280', [{ component: 'Card', bands: ['geometry'], cause: false }]),
  read('nav@1280', [{ component: 'LinkComponent', bands: ['geometry', 'token'], cause: true }]),
  read('cart@1280', []),
];

function consumers(subjects: readonly SubjectView[] = SUBJECTS) {
  return consumersOf(build({ subjects }))('Button');
}

describe('what the components drawing this one did', () => {
  it('keeps a consumer that only reflowed apart from one that moved on its own', () => {
    const found = consumers();

    expect(found.map((each) => each.component)).toEqual([
      'LinkComponent',
      'Card',
      'EmptyCart',
    ]);
    expect(found[0]).toMatchObject({
      moved: 1,
      pushed: 0,
      still: 0,
      renders: 1,
      bands: ['geometry', 'token'],
    });
    expect(found[1]).toMatchObject({ moved: 0, pushed: 2, still: 1, renders: 3, bands: [] });
    expect(found[2]).toMatchObject({ moved: 0, pushed: 0, still: 1, renders: 1 });
  });

  it('reads only the renders both are drawn in', () => {
    // `Card` is drawn in three renders and `Button` in five. A count taken over
    // the consumer's own subjects reports it holding still in renders where the
    // component being decided is not on the page at all.
    const wider = [...SUBJECTS, read('sidebar@1280', [])];

    expect(consumers(wider).find((each) => each.component === 'Sidebar')).toBeUndefined();
  });

  it('will not take a render nobody compared as one that held still', () => {
    const unread = SUBJECTS.map((subject) =>
      subject.subject === 'cart@1280' ? read('cart@1280') : subject,
    );

    const empty = consumers(unread).find((each) => each.component === 'EmptyCart');

    expect(empty).toMatchObject({ renders: 0, still: 0, unread: 1 });
  });

  it('says nothing at all when no census was ingested', () => {
    expect(consumersOf(build({ composition: null, subjects: SUBJECTS }))('Button')).toEqual([]);
    expect(consumersOf(build({ subjects: SUBJECTS }))('Ghost')).toEqual([]);
  });

  it('drops a consumer with no shared render read and none unread', () => {
    // Not the same as one that held still. Nothing here observed the pair, so
    // there is no state to report and a row would be inventing one.
    const only = [read('nav@1280', [])];

    expect(consumers(only).map((each) => each.component)).toEqual(['LinkComponent']);
  });
});

describe('the summary a reviewer reads first', () => {
  const markup = (subjects: readonly SubjectView[] = SUBJECTS, changes = new Set(['Card'])) =>
    renderToStaticMarkup(
      <Consumers found={consumersOf(build({ subjects }))('Button')} build="9" changes={changes} go={() => {}} />,
    );

  it('counts the three states in the words they are ranked by', () => {
    const page = markup();

    expect(page).toContain('<strong>3 components draw it</strong>');
    expect(page).toContain('1 held still');
    expect(page).toContain('1 pushed');
    expect(page).toContain('1 moved on its own');
  });

  it('names the bands only for the one this change does not explain', () => {
    const page = markup();

    expect(page).toContain('moved in <em>its layout and its style values</em> — 1 of 1');
    expect(page).toContain('pushed, not changed — 2 of 3');
    expect(page).toContain('held still in all 1');
  });

  it('links a consumer that has a change page and not one that has none', () => {
    const page = markup();

    expect(page).toContain('href="/builds/9/changes/Card"');
    expect(page).not.toContain('href="/builds/9/changes/LinkComponent"');
    expect(page).toContain('<span class="va-consumer-name">LinkComponent</span>');
  });

  it('marks the row that moved on its own and no other', () => {
    expect(markup().match(/va-consumer-moved/g)).toHaveLength(1);
  });

  it('renders nothing when the census places it inside nothing', () => {
    expect(
      renderToStaticMarkup(
        <Consumers
          found={consumersOf(build({ subjects: SUBJECTS }))('Sidebar')}
          build="9"
          changes={new Set()}
          go={() => {}}
        />,
      ),
    ).toBe('');
  });

  it('says how many renders nothing was read in rather than omitting them', () => {
    const unread = SUBJECTS.map((subject) =>
      subject.subject === 'grid@1280' ? read('grid@1280') : subject,
    );

    expect(markup(unread)).toContain('· 1 not read');
  });
});
