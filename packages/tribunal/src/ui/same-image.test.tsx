// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildDetail, SameImage, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { BuildPage, type BuildRoute } from './docket.js';

/**
 * Stories of one component that render one image, on the two pages a reviewer
 * reads them from: the docket says how many, and the subject page lays the
 * component's stories side by side and marks the ones that are one picture.
 *
 * Driven through `BuildPage`, because the build page is what hands the subject
 * page its build, and a grid that only rendered when given the right props
 * would pass here and draw nothing in the product.
 */

const FAMILY = 'story:product-card';
const STORIES = ['control', 'sale', 'sold-out'].map((member) => `${FAMILY}--${member}`);
const SAME: SameImage = { family: FAMILY, subjects: [`${FAMILY}--sale`, `${FAMILY}--control`] };

const story = (id: string, has = true): SubjectView => ({
  subject: id,
  verdict: 'new',
  because: 'no baseline yet',
  changedPixels: 0,
  regions: [],
  has: { before: false, after: has, diff: false },
  approvable: has,
  decision: null,
});

const detail = (subjects: readonly SubjectView[], sameImage: readonly SameImage[]): BuildDetail =>
  ({
    project: 'snkr-shop',
    build: '7',
    commit: 'c0ffee000000',
    at: '2026-06-01T12:00:00.000Z',
    identity: { engine: 'chromium@131' },
    retention: 'durable',
    verdicts: { changed: 0, unchanged: 0, new: subjects.length, incomparable: 0, ignored: 0 },
    decided: 0,
    pending: subjects.length,
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
    previous: null,
    subjects,
    notObserved: [],
    causes: [],
    variations: [],
    sameImage,
    reach: null,
    journeys: null,
    declarations: { ignores: null, sensitivities: null },
    composition: null,
    movements: [],
  }) as unknown as BuildDetail;

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // The subject page scrolls its panes back to the top on every subject, and
  // jsdom lays nothing out to scroll.
  HTMLElement.prototype.scrollTo = () => undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function show(build: BuildDetail, route: BuildRoute): Promise<void> {
  const client = {
    build: async () => build,
    imageUrl: (at: string, subject: string, kind: string) => `/img/${at}/${subject}/${kind}`,
  } as unknown as ReviewClient;
  await act(async () => {
    root.render(<BuildPage client={client} reviewer="marina" route={route} go={() => undefined} />);
  });
}

describe('the docket names the stories that render one image', () => {
  it('counts them and says which component each group is a story of', async () => {
    await show(detail(STORIES.map((id) => story(id)), [SAME]), { page: 'build', build: '7' });

    const note = host.querySelector('.va-same-image');
    expect(note?.textContent).toContain('2 variations render the same image');
    expect(note?.textContent).toContain(FAMILY);
    expect([...(note?.querySelectorAll('a') ?? [])].map((link) => link.getAttribute('href'))).toEqual([
      `/builds/7/subjects/${encodeURIComponent(`${FAMILY}--sale`)}`,
      `/builds/7/subjects/${encodeURIComponent(`${FAMILY}--control`)}`,
    ]);
  });

  it('says nothing when no two stories of a component render one image', async () => {
    await show(detail(STORIES.map((id) => story(id)), []), { page: 'build', build: '7' });

    expect(host.querySelector('.va-same-image')).toBeNull();
    expect(host.textContent).not.toContain('render the same image');
  });
});

describe('the subject page lays its component’s stories side by side', () => {
  const at = (subject: string): BuildRoute => ({ page: 'subject', build: '7', subject });

  it('draws every story of the component, and marks the ones that are one image', async () => {
    await show(detail(STORIES.map((id) => story(id)), [SAME]), at(`${FAMILY}--sale`));

    const tiles = [...host.querySelectorAll('.va-siblings .va-sibling')];
    // The lattice's order, which with no link read is the shortest name first.
    expect(tiles.map((tile) => tile.querySelector('img')?.getAttribute('src'))).toEqual(
      ['sale', 'control', 'sold-out'].map((member) => `/img/7/${FAMILY}--${member}/after`),
    );
    const marked = tiles.filter((tile) => tile.classList.contains('va-sibling-same'));
    expect(marked.map((tile) => tile.querySelector('img')?.getAttribute('alt'))).toEqual(SAME.subjects);
    expect(host.querySelector('.va-sibling-here')?.textContent).toContain('sale');
    expect(host.querySelector('.va-siblings')?.textContent).toContain('renders the same image as control');
  });

  it('draws no tile for a story with no candidate, rather than a broken picture', async () => {
    await show(
      detail([story(STORIES[0] as string), story(STORIES[1] as string), story(STORIES[2] as string, false)], []),
      at(`${FAMILY}--sale`),
    );

    expect(host.querySelectorAll('.va-siblings .va-sibling')).toHaveLength(2);
    expect(host.querySelector('.va-siblings')?.textContent).toContain('1 story kept no candidate');
  });

  it('draws the first 24 stories of a large component and counts the rest', async () => {
    const many = Array.from({ length: 26 }, (_, index) => `${FAMILY}--state-${String(index).padStart(2, '0')}`);
    await show(detail(many.map((id) => story(id)), []), at(many[0] as string));

    expect(host.querySelectorAll('.va-siblings .va-sibling')).toHaveLength(24);
    expect(host.querySelector('.va-siblings')?.textContent).toContain('2 further stories not drawn');
  });

  it('draws nothing for a subject that is the only story of its component', async () => {
    await show(detail([story('story:toolbar'), ...STORIES.map((id) => story(id))], [SAME]), at('story:toolbar'));

    expect(host.querySelector('.va-siblings')).toBeNull();
  });
});
