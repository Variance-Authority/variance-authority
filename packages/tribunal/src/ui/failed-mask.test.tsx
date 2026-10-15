// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { SubjectView } from '../review.js';
import { createReviewClient } from './client.js';
import { Viewer } from './viewer.js';

/**
 * The difference mode when the page cannot compute the mask.
 *
 * A build that kept no mask has it computed in the page from the two captures,
 * and that can fail: a capture the service will not serve, or one the browser
 * will not decode. The failure arrives after the first frame, so this mounts the
 * viewer and lets the computation finish.
 */

let host: HTMLDivElement;
let root: Root;
/** jsdom has no scrolling, and the viewer returns its stage to the origin on mount. */
const scrollTo = Element.prototype.scrollTo;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  Element.prototype.scrollTo = () => undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
  Element.prototype.scrollTo = scrollTo;
});

const SUBJECT: SubjectView = {
  subject: 'story:card',
  verdict: 'changed',
  because: 'the rendered image differs from the baseline',
  changedPixels: 1530,
  regions: [],
  has: { before: true, after: true, diff: false },
  approvable: true,
  decision: null,
};

describe('a difference mask the page could not compute', () => {
  it('is reported as failed, with the reason, rather than as still being made', async () => {
    // "Working out the difference…" over a computation that has already failed
    // stays on screen for as long as the page is open.
    const refusing = createReviewClient({
      endpoint: '/api',
      fetch: (async () => new Response('gone', { status: 404 })) as typeof globalThis.fetch,
    });
    act(() => root.render(<Viewer client={refusing} build="ci-1" subject={SUBJECT} />));
    await act(async () => {
      press('difference');
      await new Promise((settle) => setTimeout(settle, 0));
    });

    expect(host.textContent).not.toContain('Working out the difference');
    expect(host.textContent).toContain('This page could not compute the difference mask');
    expect(host.textContent).toContain('answered 404');
    expect(host.querySelector('.va-viewer')?.getAttribute('aria-busy')).toBeNull();
  });

  it('is said outside the stage, with no region ringed over the sentence', async () => {
    // The rings are placed on the mask's pixels. With no mask they are drawn
    // over whatever stands in for it, and they cover the reason.
    const refusing = createReviewClient({
      endpoint: '/api',
      fetch: (async () => new Response('gone', { status: 404 })) as typeof globalThis.fetch,
    });
    act(() => root.render(<Viewer client={refusing} build="ci-1" subject={RINGED} />));
    await act(async () => {
      press('difference');
      await new Promise((settle) => setTimeout(settle, 0));
    });

    expect(host.textContent).toContain('This page could not compute the difference mask');
    expect(host.querySelector('.va-loupe')?.textContent).not.toContain('could not compute');
    expect(host.querySelector('.va-regions')).toBeNull();
  });

  it('is said outside the stage while it is being made, too', () => {
    const waiting = createReviewClient({
      endpoint: '/api',
      fetch: (() => new Promise<Response>(() => undefined)) as typeof globalThis.fetch,
    });
    act(() => root.render(<Viewer client={waiting} build="ci-1" subject={RINGED} />));
    act(() => press('difference'));

    expect(host.textContent).toContain('Working out the difference');
    expect(host.querySelector('.va-loupe')?.textContent).not.toContain('Working out');
    expect(host.querySelector('.va-regions')).toBeNull();
    // The mask arrives from an object URL, which no wire and no image node
    // announces, so the viewer says it is not done for a reading to wait on.
    expect(host.querySelector('.va-viewer')?.getAttribute('aria-busy')).toBe('true');
  });

  it('keeps the stage where the reviewer left it while the mask is made', () => {
    // A reviewer zoomed and scrolled to a region, then asked for the mask. A
    // stage taken down and put back for the wait comes back at the origin, and
    // the region they were reading is gone from the pane.
    const waiting = createReviewClient({
      endpoint: '/api',
      fetch: (() => new Promise<Response>(() => undefined)) as typeof globalThis.fetch,
    });
    act(() => root.render(<Viewer client={waiting} build="ci-1" subject={RINGED} />));
    const stage = host.querySelector('.va-loupe');
    const plate = host.querySelector('.va-plate');
    act(() => press('difference'));

    expect(stage).not.toBeNull();
    expect(host.querySelector('.va-loupe')).toBe(stage);
    expect(host.querySelector('.va-plate')).toBe(plate);
  });
});

/** A subject the run found regions in, at the size it captured. */
const RINGED: SubjectView = {
  ...SUBJECT,
  size: { width: 330, height: 288 },
  baseline: { width: 330, height: 276 },
  regions: [{ x: 10, y: 20, width: 200, height: 10, pixels: 1276 }],
};

/** Presses the toggle that reads `label`, as a reviewer would. */
function press(label: string): void {
  const button = [...host.querySelectorAll('button')].find((each) => each.textContent === label);
  if (button === undefined) throw new Error(`no button reads ${label}`);
  button.click();
}
