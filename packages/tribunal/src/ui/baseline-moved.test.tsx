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

const MOVED =
  'the baseline for "story:card" moved while you were reviewing: you read no baseline, and it is ' +
  'now the one painted from document feedface';

interface Sent {
  readonly url: string;
  readonly body: Record<string, unknown>;
}

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

let host: HTMLDivElement;
let root: Root;
let sent: Sent[];
let reloads: number;

beforeEach(() => {
  // jsdom lays nothing out, so it has no scrolling either, and the panel scrolls
  // to the top of a subject it is shown.
  Element.prototype.scrollTo ??= () => undefined;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
  sent = [];
  reloads = 0;
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
  return new Response(JSON.stringify({ error: MOVED }), { status: 409 });
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
        onDecided={() => (reloads += 1)}
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
        onDecided={() => (reloads += 1)}
      />,
    );
  });
}

function button(name: string): HTMLButtonElement {
  const found = [...host.querySelectorAll('button')].find((each) => each.textContent?.trim() === name);
  if (found === undefined) throw new Error(`no "${name}" button on the panel`);
  return found;
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

    expect(host.textContent).toContain('The baseline changed while you were reviewing');
    expect(host.textContent).toContain('painted from document feedface');
    expect(host.textContent).not.toContain('answered 409');
    expect(reloads).toBe(0);

    act(() => button('Reload this subject').click());
    expect(reloads).toBe(1);
    expect(host.textContent).not.toContain('The baseline changed while you were reviewing');
  });
});

describe('a decision about a baseline that moved, taken on the change page', () => {
  it('sends the version from one render\'s row and from the whole change', async () => {
    renderChange(subject({ baselineVersion: 'deadbeef' }));

    await act(async () => button('✓').click());
    await act(async () => button('Approve this change (1)').click());

    expect(sent.map((each) => each.body['baselineVersion'])).toEqual(['deadbeef', 'deadbeef']);
  });

  it('shows the service\'s sentence rather than a request that failed', async () => {
    renderChange(subject());

    await act(async () => button('Approve this change (1)').click());

    expect(host.textContent).toContain('The baseline changed while you were reviewing');
    expect(host.textContent).toContain('painted from document feedface');
    expect(host.textContent).not.toContain('answered 409');
  });
});
