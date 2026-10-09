// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildDetail, SubjectView } from '../review-types.js';
import { ChangePanel } from './change.js';
import { createReviewClient } from './client.js';
import { originsOf } from './grouping.js';
import { SubjectPanel } from './subject.js';

/**
 * A decision the service refused because the baseline moved under it, on both
 * pages a decision is taken on: the subject panel and the change page.
 *
 * Driven through the real client over a fake `fetch`, because the claim is about
 * the wire as much as the page: the version the page read has to leave in the
 * body, and the 409 that comes back has to reach the reviewer as the sentence it
 * is rather than as a request that failed.
 */

/** The document the baseline standing now was painted from, as the store writes one. */
const CURRENT = 'v1:c7cab60fc975adfc7ac9550632677751';

const MOVED =
  'the baseline for "story:card" moved while you were reviewing: you read no baseline, and it is ' +
  `now the one painted from document ${CURRENT}. Nothing was recorded. The images are still the ` +
  'ones the run compared; reload the subject to decide against the baseline standing now';

interface Sent {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let sent: Sent[];
let reloads: number;
/** What the service answers a decision with; a refusal unless a test says otherwise. */
let answer: () => Response;

beforeEach(() => {
  // jsdom lays nothing out, so it has no scrolling either, and the panel scrolls
  // to the top of a subject it is shown.
  Element.prototype.scrollTo ??= () => undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  sent = [];
  reloads = 0;
  answer = () => new Response(JSON.stringify({ error: MOVED, read: null, current: CURRENT }), { status: 409 });
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

const pending = new Promise<Response>(() => undefined);

async function fetchThat(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  const url = String(input);
  if (!url.endsWith('/decision')) return pending;
  sent.push({ url, body: JSON.parse(String(init?.body)) as Record<string, unknown> });
  return answer();
}

function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'story:card',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 4,
    has: { before: false, after: true, diff: false },
    regions: [{ x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, component: 'Button', fingerprint: 'f1' }],
    approvable: true,
    decision: null,
    baselineVersion: null,
    ...overrides,
  };
}

function render(view: SubjectView): void {
  const client = createReviewClient({ endpoint: '/api', fetch: fetchThat });
  act(() => {
    root.render(
      <SubjectPanel
        client={client}
        reviewer="marina"
        build="ci-1"
        subject={view}
        onDecided={() => {
          reloads += 1;
        }}
      />,
    );
  });
}

/** The change page for a build holding this one subject. */
function renderChange(view: SubjectView): void {
  const detail = {
    project: 'snkr-shop',
    build: 'ci-1',
    commit: 'abc1234',
    at: '2026-06-01T12:00:00.000Z',
    identity: {},
    retention: 'durable',
    verdicts: { changed: 1, unchanged: 0, new: 0, incomparable: 0, unstable: 0, ignored: 0 },
    decided: 0,
    pending: 1,
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
    subjects: [view],
    notObserved: [],
    declarations: { ignores: null, sensitivities: null },
    movements: [],
    composition: null,
    causes: [],
    variations: [],
    reach: null,
  } as unknown as BuildDetail;
  const origin = originsOf(detail).origins[0];
  if (origin === undefined) throw new Error('this build holds no change to draw');

  const client = createReviewClient({ endpoint: '/api', fetch: fetchThat });
  act(() => {
    root.render(
      <ChangePanel
        client={client}
        reviewer="marina"
        build={detail}
        origin={origin}
        crossing={{ state: 'none' }}
        changes={new Set()}
        go={() => undefined}
        onDecided={() => {
          reloads += 1;
        }}
      />,
    );
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((each) => each.textContent?.trim() === name);
  if (found === undefined) throw new Error(`no "${name}" button on the panel`);
  return found;
}

/** What the panel says, as a reader sees it. */
function said(): string {
  return host.textContent ?? '';
}

/**
 * Said once, in the page's words: the headline, both baselines with their
 * digests as short as a commit, and that nothing landed. Not the service's
 * sentence under it, which repeated the headline and spelled the digest out.
 */
function expectReadable(): void {
  expect(said().split('changed while you were reviewing')).toHaveLength(2);
  expect(said()).not.toContain('moved while you were reviewing');
  expect(said()).toContain('You read none; the one standing now is painted from document v1:c7cab60f.');
  expect(said()).not.toContain(CURRENT);
  expect(host.querySelector(`code[title="${CURRENT}"]`)?.textContent).toBe('v1:c7cab60f');
  expect(said()).not.toContain('answered 409');
}

describe('a decision about a baseline that moved, taken on the subject panel', () => {
  it('sends the baseline version the page read', async () => {
    render(subject({ baselineVersion: 'deadbeef' }));

    await act(async () => button('Approve').click());

    expect(sent).toHaveLength(1);
    expect(sent[0]?.body).toMatchObject({ decision: 'approved', baselineVersion: 'deadbeef' });
  });

  it('sends null for a subject that had no baseline, and nothing when the page has no version', async () => {
    render(subject());
    await act(async () => button('Reject').click());
    render(subject({ baselineVersion: undefined }));
    await act(async () => button('Reject').click());

    expect(sent[0]?.body['baselineVersion']).toBeNull();
    expect(sent[1]?.body).not.toHaveProperty('baselineVersion');
  });

  it('says the baseline changed and offers to reload the subject, rather than a failed request', async () => {
    render(subject());

    await act(async () => button('Approve').click());

    expect(said()).toContain('The baseline changed while you were reviewing.');
    expectReadable();
    expect(said()).toContain('Nothing was recorded.');
    expect(reloads).toBe(0);

    act(() => button('Reload this subject').click());
    expect(reloads).toBe(1);
    expect(host.textContent).not.toContain('The baseline changed while you were reviewing');
  });

  it('takes no decision until the reload has brought the version standing now', async () => {
    // The page still holds the version it read until the build answers again, so
    // a decision taken in between would send it and be refused a second time.
    let reloaded: () => void = () => undefined;
    const client = createReviewClient({ endpoint: '/api', fetch: fetchThat });
    act(() => {
      root.render(
        <SubjectPanel
          client={client}
          reviewer="marina"
          build="ci-1"
          subject={subject()}
          onDecided={() => new Promise<void>((resolve) => (reloaded = resolve))}
        />,
      );
    });
    await act(async () => button('Approve').click());
    await act(async () => reloaded());

    await act(async () => button('Reload this subject').click());
    expect(button('Approve').disabled).toBe(true);
    expect(button('Reject').disabled).toBe(true);

    await act(async () => reloaded());
    expect(button('Approve').disabled).toBe(false);
  });

  it('takes no second decision until a landed one has been read back', async () => {
    // A decision that lands moves the baseline itself, so a second press before
    // the build answers again would send the old version and be refused.
    answer = () => new Response(JSON.stringify({ decision: 'approved' }), { status: 201 });
    let reloaded: () => void = () => undefined;
    const client = createReviewClient({ endpoint: '/api', fetch: fetchThat });
    act(() => {
      root.render(
        <SubjectPanel
          client={client}
          reviewer="marina"
          build="ci-1"
          subject={subject()}
          onDecided={() => new Promise<void>((resolve) => (reloaded = resolve))}
        />,
      );
    });

    await act(async () => button('Approve').click());
    expect(button('Reject').disabled).toBe(true);

    await act(async () => reloaded());
    expect(button('Reject').disabled).toBe(false);
  });

  it('reads what moved from a refusal longer than the message quotes', async () => {
    answer = () =>
      new Response(JSON.stringify({ error: MOVED.padEnd(600, '.'), read: null, current: CURRENT }), { status: 409 });
    render(subject());

    await act(async () => button('Approve').click());

    expectReadable();
  });
});

describe('a decision about a baseline that moved, taken on the change page', () => {
  it('sends the version from one render\'s row and from the whole change', async () => {
    renderChange(subject({ baselineVersion: 'deadbeef' }));

    await act(async () => button('✓').click());
    await act(async () => button('Approve this change (1)').click());

    expect(sent.map((each) => each.body['baselineVersion'])).toEqual(['deadbeef', 'deadbeef']);
  });

  it('says the baseline changed on the render\'s row, and offers to reload the subject', async () => {
    renderChange(subject());

    await act(async () => button('✓').click());

    expect(said()).toContain('The baseline changed while you were reviewing.');
    expectReadable();
    expect(reloads).toBe(0);

    await act(async () => button('Reload this subject').click());
    expect(reloads).toBe(1);
  });

  it('names the render a whole-change decision stopped at, and offers to reload the change', async () => {
    renderChange(subject());

    await act(async () => button('Approve this change (1)').click());

    expect(said()).toContain('The baseline for story:card changed while you were reviewing.');
    expectReadable();
    expect(said()).toContain('No decision was recorded for it, nor for any render after it.');

    await act(async () => button('Reload this change').click());
    expect(reloads).toBe(1);
  });
});
