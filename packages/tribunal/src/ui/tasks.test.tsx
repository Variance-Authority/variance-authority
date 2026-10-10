// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Concern, ConcernState } from '../concern-types.js';
import type { BuildDetail, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { BuildPage } from './docket.js';
import type { Route } from './route.js';

/**
 * The tasks at the top of the rail: what a build still asks of its reviewers.
 *
 * A reviewer opening a build could see how many renders awaited a decision and
 * how many concerns stood, as two lines in the header, and then had to find them
 * by reading every row of the rail. The tasks name each kind of work, count the
 * renders it covers, and narrow the rail to them in one click.
 */

function subject(name: string, overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: name,
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

const SUBJECTS: readonly SubjectView[] = [
  subject('story:cart'),
  subject('story:card', { changedPixels: 90 }),
  subject('story:decided', { decision: { decision: 'approved', by: 'marina', at: '2026-06-01T12:00:00.000Z' } as never }),
  // Nothing to decide, and a concern still stands on it from an earlier build.
  subject('story:quiet', { verdict: 'unchanged', changedPixels: 0 }),
];

function build(subjects: readonly SubjectView[] = SUBJECTS): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '6',
    commit: 'commit60000000',
    at: '2026-06-01T12:00:00.000Z',
    identity: { renderer: 'playwright-chromium', engine: 'chromium@131' } as never,
    retention: 'durable',
    verdicts: { changed: 3, unchanged: 1, new: 0, incomparable: 0, unstable: 0, ignored: 0, failed: 0 },
    decided: 1,
    pending: 2,
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
    subjects,
    notObserved: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: null,
    causes: [],
    variations: [],
    reach: null,
    journeys: null,
    previous: null,
  };
}

function concern(id: number, on: string, state: ConcernState): Concern {
  return { id, build: '5', subject: on, title: `concern ${id}`, evidence: [], by: 'marina', at: '2026-06-01T12:00:00.000Z', state, events: [] };
}

const STANDING: readonly Concern[] = [
  concern(1, 'story:card', 'open'),
  concern(2, 'story:quiet', 'open'),
  concern(5, 'story:quiet', 'open'),
  concern(3, 'story:quiet', 'investigating'),
  concern(4, 'story:decided', 'resolved'),
];

/** Answers the build and its concerns; anything else the page asks for never arrives. */
function clientThat(concerns: ReviewClient['concerns'], subjects: readonly SubjectView[]): ReviewClient {
  const never = (): Promise<never> => new Promise(() => undefined);
  return new Proxy({} as ReviewClient, {
    get: (_, name) => {
      if (name === 'build') return async () => build(subjects);
      if (name === 'concerns') return concerns;
      if (name === 'imageUrl') return () => '';
      return never;
    },
  });
}

const tallyOf = (concerns: readonly Concern[]) => ({
  open: concerns.filter((each) => each.state === 'open').length,
  investigating: concerns.filter((each) => each.state === 'investigating').length,
  resolved: concerns.filter((each) => each.state === 'resolved').length,
});

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom draws nothing, so it has no scrolling; the subject page scrolls its stage.
  Element.prototype.scrollTo = () => undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

async function open(
  route: Extract<Route, { page: 'build' | 'subject' }>,
  concerns: ReviewClient['concerns'] = async () => ({ concerns: STANDING, tally: tallyOf(STANDING) }),
  subjects: readonly SubjectView[] = SUBJECTS,
): Promise<Route[]> {
  const went: Route[] = [];
  await act(async () => {
    root.render(<BuildPage client={clientThat(concerns, subjects)} reviewer="marina" route={route} go={(to) => went.push(to)} />);
  });
  return went;
}

function tasks(): HTMLElement {
  return host.querySelector<HTMLElement>('.va-tasks')!;
}

function task(name: string): HTMLButtonElement {
  return [...tasks().querySelectorAll('button')].find((each) => each.textContent?.startsWith(name))!;
}

function railed(): string[] {
  return [...host.querySelectorAll('.va-rail-list li .va-rail-name')].map((each) => each.textContent ?? '');
}

describe('the rail names the work a build still asks for', () => {
  it('counts the renders in each task, not the concerns', async () => {
    await open({ page: 'build', build: '6' });

    expect(task('Unreviewed').textContent).toBe('Unreviewed2');
    // Two open concerns stand on story:quiet; it is one render to open.
    expect(task('Open').textContent).toBe('Open2');
    expect(task('Investigating').textContent).toBe('Investigating1');
    expect(task('Resolved').textContent).toBe('Resolved1');
  });

  it('counts in Unreviewed what the header counts as awaiting review', async () => {
    // An unstable render sits in the rail, but no decision pends on it: the
    // header's count leaves it out, and the task beside it must too.
    await open({ page: 'build', build: '6' }, undefined, [...SUBJECTS, subject('story:shaky', { verdict: 'unstable' })]);

    expect(task('Unreviewed').textContent).toBe('Unreviewed2');
  });

  it('opens the first render of a task, with the rail narrowed to it', async () => {
    const went = await open({ page: 'build', build: '6' });

    act(() => task('Open').click());

    expect(went).toEqual([{ page: 'subject', build: '6', subject: 'story:card', task: 'open' }]);
  });

  it('lists only the task’s renders, a settled one included, and marks the task chosen', async () => {
    await open({ page: 'subject', build: '6', subject: 'story:card', task: 'open' });

    expect(railed()).toEqual(['story:card', 'story:quiet']);
    expect(task('Open').getAttribute('aria-pressed')).toBe('true');
    expect(task('Unreviewed').getAttribute('aria-pressed')).toBe('false');
  });

  it('puts the whole queue back when the chosen task is pressed again', async () => {
    const went = await open({ page: 'subject', build: '6', subject: 'story:card', task: 'open' });

    act(() => task('Open').click());

    expect(went).toEqual([{ page: 'subject', build: '6', subject: 'story:card' }]);
  });

  it('keeps the render on screen when it is in the chosen task', async () => {
    const went = await open({ page: 'subject', build: '6', subject: 'story:cart' });

    act(() => task('Unreviewed').click());

    expect(went).toEqual([{ page: 'subject', build: '6', subject: 'story:cart', task: 'unreviewed' }]);
  });

  it('opens the task’s first render when the one on screen is not in it', async () => {
    const went = await open({ page: 'subject', build: '6', subject: 'story:cart' });

    act(() => task('Open').click());

    expect(went).toEqual([{ page: 'subject', build: '6', subject: 'story:card', task: 'open' }]);
  });

  it('walks the task with the bar, and keeps the task on the way', async () => {
    const went = await open({ page: 'subject', build: '6', subject: 'story:card', task: 'open' });

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    });

    expect(went).toEqual([{ page: 'subject', build: '6', subject: 'story:quiet', task: 'open' }]);
  });

  it('keeps a render that left the task in its place until the reviewer moves on', async () => {
    // Decided, so no longer unreviewed: the reviewer just approved it here.
    const went = await open({ page: 'subject', build: '6', subject: 'story:decided', task: 'unreviewed' });

    expect(railed()).toEqual(['story:cart', 'story:decided', 'story:card']);
    expect(host.querySelector('.va-actionbar')?.textContent).toContain('2 of 3');
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    });
    expect(went).toEqual([{ page: 'subject', build: '6', subject: 'story:card', task: 'unreviewed' }]);
  });

  it('keeps a render that left the task where the whole build puts it', async () => {
    // By name, the new render comes first, and it heads the build's order: left
    // out and added back after its peers, it would jump to the end of the rail.
    const decided = { decision: 'approved', by: 'marina', at: '2026-06-01T12:00:00.000Z' } as never;
    const subjects = [subject('story:a', { verdict: 'new', decision: decided }), subject('story:b'), subject('story:c', { changedPixels: 90 })];
    await open({ page: 'subject', build: '6', subject: 'story:a', task: 'unreviewed' }, undefined, subjects);

    expect(railed()).toEqual(['story:a', 'story:b', 'story:c']);
    expect(host.querySelector('.va-actionbar')?.textContent).toContain('1 of 3');
  });

  it('walks nothing else while the task’s renders are still being read', async () => {
    const went = await open({ page: 'subject', build: '6', subject: 'story:card', task: 'open' }, () => new Promise(() => undefined));

    expect(railed()).toEqual(['story:card']);
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'j', bubbles: true }));
    });
    expect(went).toEqual([]);
  });

  it('keeps the task on the Subjects switch', async () => {
    await open({ page: 'subject', build: '6', subject: 'story:card', task: 'open' });

    const link = [...host.querySelectorAll<HTMLAnchorElement>('.va-switch a')].find((each) => each.textContent === 'Subjects');
    expect(link?.getAttribute('href')).toContain('?task=open');
  });

  it('offers no task with nothing in it', async () => {
    await open({ page: 'build', build: '6' }, async () => ({ concerns: [], tally: tallyOf([]) }));

    expect(task('Open').disabled).toBe(true);
    expect(task('Unreviewed').disabled).toBe(false);
  });

  it('says the concern tasks could not be read, never that they are empty', async () => {
    await open({ page: 'build', build: '6' }, () => Promise.reject(new Error('GET /review/concerns answered 404')));

    expect(task('Open').textContent).toBe('Open?');
    expect(task('Open').disabled).toBe(true);
    expect(task('Open').title).toContain('answered 404');
    expect(task('Unreviewed').textContent).toBe('Unreviewed2');
  });

  it('lets a chosen task be put down when its concerns could not be read', async () => {
    const went = await open(
      { page: 'subject', build: '6', subject: 'story:card', task: 'open' },
      () => Promise.reject(new Error('GET /review/concerns answered 404')),
    );

    expect(task('Open').disabled).toBe(false);
    act(() => task('Open').click());
    expect(went).toEqual([{ page: 'subject', build: '6', subject: 'story:card' }]);
  });
});
