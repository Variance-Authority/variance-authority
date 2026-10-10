// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Decision, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { queueOf } from './rail.js';
import { SubjectPanel, type Place } from './subject.js';

/**
 * The bar under a subject: what is selected, where it sits in the queue, and
 * every move a reviewer can make from here, each with the key that makes it.
 *
 * Mounted rather than rendered statically, because what the bar is for is the
 * second subject and the twentieth: the keys, the move to the next one, and the
 * form a flag opens. None of that is in a first frame.
 */

function subject(name: string, overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: name,
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 1530,
    regions: [
      { x: 0, y: 0, width: 10, height: 10, pixels: 90, cause: true, component: 'Button' },
      { x: 0, y: 20, width: 10, height: 4, pixels: 30, cause: false, component: 'Card' },
    ],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...overrides,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  // jsdom lays nothing out, so it has no scrolling; the page and the viewer both
  // return to the top on a new subject.
  Element.prototype.scrollTo = () => undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A client that records decisions, lists no concerns and has no pictures. */
function clientThat(): ReviewClient & { readonly decided: [string, Decision][] } {
  const decided: [string, Decision][] = [];
  const never = (): Promise<never> => new Promise(() => undefined);
  return {
    decided,
    builds: never,
    build: never,
    changelog: never,
    churn: never,
    reach: never,
    flakiness: never,
    lastChanged: never,
    sweep: never,
    async decide(_build: string, on: string, decision: Decision) {
      decided.push([on, decision]);
    },
    concerns: async () => ({ concerns: [], tally: { open: 0, investigating: 0, resolved: 0 } }),
    raise: never,
    moveConcern: never,
    imageUrl: () => '',
    imageBlob: never,
  } as unknown as ReviewClient & { readonly decided: [string, Decision][] };
}

async function show(
  on: SubjectView,
  place: Place | undefined,
  client: ReviewClient = clientThat(),
): Promise<string[]> {
  const went: string[] = [];
  await act(async () => {
    root.render(
      <SubjectPanel
        client={client}
        reviewer="marina"
        build="ci-1"
        subject={on}
        place={place}
        onGo={(next) => went.push(next)}
        onDecided={() => undefined}
      />,
    );
  });
  return went;
}

function press(key: string, target: EventTarget = document.body, init: KeyboardEventInit = {}): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true, ...init }));
  });
}

function bar(): HTMLElement {
  return host.querySelector<HTMLElement>('.va-actionbar')!;
}

function button(name: string): HTMLButtonElement {
  return [...bar().querySelectorAll('button')].find((each) => each.textContent?.startsWith(name))!;
}

describe('the bar says what is selected and where it sits', () => {
  it('names the render, the component that moved, its regions and its place in the queue', async () => {
    await show(subject('story:cart'), { at: 1, of: 5, previous: 'story:a', next: 'story:b' });

    expect(bar().textContent).toContain('story:cart');
    expect(bar().textContent).toContain('Button');
    expect(bar().textContent).toContain('2 regions');
    expect(bar().textContent).toContain('2 of 5');
  });

  it('says a render is outside the queue rather than numbering it', async () => {
    await show(subject('story:still', { verdict: 'unchanged' }), { of: 5, next: 'story:a' });

    expect(bar().textContent).toContain('not in the queue');
    expect(bar().textContent).not.toContain('of 5');
  });
});

describe('every move is a button and a key', () => {
  it('walks the queue with J and K, and with the buttons', async () => {
    const went = await show(subject('story:cart'), { at: 1, of: 3, previous: 'story:a', next: 'story:b' });

    press('j');
    press('k');
    await act(async () => button('Next').click());

    expect(went).toEqual(['story:b', 'story:a', 'story:b']);
  });

  it('offers no previous on the first render and no next on the last', async () => {
    await show(subject('story:a'), { at: 0, of: 1 });

    expect(button('Previous').disabled).toBe(true);
    expect(button('Next').disabled).toBe(true);
  });

  it('never moves while the reviewer is typing', async () => {
    const went = await show(subject('story:cart'), { at: 1, of: 3, previous: 'story:a', next: 'story:b' });
    await act(async () => button('Looks suspicious').click());

    press('j', host.querySelector('input[name="title"]')!);
    press('j', document.body, { metaKey: true });

    expect(went).toEqual([]);
  });

  it('opens the concern form as open on F and as investigating on I', async () => {
    await show(subject('story:cart'), { at: 0, of: 1 });

    press('f');
    expect(host.querySelector<HTMLInputElement>('input[name="state"][value="open"]')?.checked).toBe(true);

    press('i');
    expect(host.querySelector<HTMLInputElement>('input[name="state"][value="investigating"]')?.checked).toBe(true);
  });

  it('decides from the bar, and from no key', async () => {
    // A key that promotes a baseline is a key a reviewer presses by accident;
    // moving between renders and opening a form are the moves that cost nothing.
    const client = clientThat();
    await show(subject('story:cart'), { at: 0, of: 1 }, client);

    press('a');
    press('r');
    await act(async () => button('Approve').click());

    expect(client.decided).toEqual([['story:cart', 'approved']]);
  });
});

describe('queueOf', () => {
  it('is the rail read top to bottom: verdicts as they first appear, largest first inside each', () => {
    const order = queueOf([
      subject('small', { changedPixels: 10 }),
      subject('fresh', { verdict: 'new', changedPixels: 900 }),
      subject('large', { changedPixels: 500 }),
    ]);

    expect(order.map((each) => each.subject)).toEqual(['large', 'small', 'fresh']);
  });
});
