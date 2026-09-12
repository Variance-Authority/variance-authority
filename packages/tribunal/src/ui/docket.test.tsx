// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildDetail, BuildSummary, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { BuildPage } from './docket.js';

/**
 * The line the build page opens on, held to what it is allowed to say.
 *
 * It is the first sentence a reviewer reads, and it was assembled out of three
 * counts whether or not there was anything to count — *0 moved for the first
 * time* on a run where nothing was new. A reader then has to work out that a
 * number they were shown means the thing did not happen. Absent is not zero.
 */

function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'story:card',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 1530,
    regions: [
      { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, component: 'Button', fingerprint: 'v1:aaa' },
    ],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
    ...overrides,
  };
}

function build(id: string, subjects: readonly SubjectView[]): BuildDetail {
  return {
    project: 'snkr-shop',
    build: id,
    commit: `commit${id}0000000`,
    at: '2026-06-01T12:00:00.000Z',
    identity: { renderer: 'playwright-chromium', engine: 'chromium@131' } as never,
    retention: 'durable',
    verdicts: { changed: 1, unchanged: 0, new: 0, incomparable: 0, unstable: 0, ignored: 0, failed: 0 },
    decided: 0,
    pending: 1,
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
    // Builds 5 and 6 of the example repository, and 6 is the one with a run
    // before it. The page reads this rather than a listing, which is why the
    // client below may refuse `builds` outright.
    previous: id === '6' ? '5' : null,
  };
}

let host: HTMLDivElement;
let root: Root;

beforeEach(() => {
  (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
  host = document.createElement('div');
  document.body.append(host);
  root = createRoot(host);
});

afterEach(() => {
  act(() => root.unmount());
  host.remove();
});

/** A client answering the two calls the build page and its crossing make. */
function clientThat(now: BuildDetail, earlier: BuildDetail): ReviewClient {
  const refuse = (): never => {
    throw new Error('the build page reads the build list and two builds, nothing else');
  };

  return {
    builds: async (): Promise<readonly BuildSummary[]> => [now, earlier],
    build: async (id: string) => (id === earlier.build ? earlier : now),
    changelog: refuse,
    churn: refuse,
    reach: refuse,
    flakiness: refuse,
    lastChanged: refuse,
    decide: refuse,
    sweep: refuse,
    imageUrl: () => '',
  } as unknown as ReviewClient;
}

async function open(now: BuildDetail, earlier: BuildDetail): Promise<string> {
  await act(async () => {
    root.render(
      <BuildPage
        client={clientThat(now, earlier)}
        reviewer="marina"
        route={{ page: 'build', build: now.build }}
        go={() => undefined}
      />,
    );
  });
  return host.textContent ?? '';
}

describe('the opening line counts only what there is something to count', () => {
  it('leaves out the readings this run has none of', async () => {
    const text = await open(build('6', [subject()]), build('5', [subject()]));

    expect(text).toContain('1 subject carries a difference it already had');
    expect(text).not.toContain('moved for the first time');
    expect(text).not.toContain('held still in both');
  });

  it('says what it means rather than printing three zeroes', async () => {
    // Every subject differs, and differs from how it differed. There is nothing
    // to count in any of the three clauses, and a line of zeroes would read as a
    // quiet run.
    const moved = subject({
      regions: [
        { x: 0, y: 0, width: 10, height: 10, pixels: 100, cause: true, component: 'Button', fingerprint: 'v1:bbb' },
      ],
    });
    const text = await open(build('6', [subject()]), build('5', [moved]));

    expect(text).toContain('nothing here is a difference it also carried');
    expect(text).not.toMatch(/\b0 /);
  });
});

/**
 * The chrome a page wears before it has anything to put in it.
 *
 * A build that is still loading, or one that failed to load, used to render an
 * empty ground with a single grey line on it: no brand, no crumb, nothing to
 * click. A reader who arrived on a link and hit a slow or broken request had the
 * back button and nothing else, and the page they were promised had no shape
 * until it was all there.
 */
describe('a build that has not arrived still wears its chrome', () => {
  function pending(answer: () => Promise<BuildDetail>): ReviewClient {
    const refuse = (): never => {
      throw new Error('nothing but the build is read before the build is read');
    };
    return {
      builds: refuse,
      build: answer,
      changelog: refuse,
      churn: refuse,
      reach: refuse,
      flakiness: refuse,
      lastChanged: refuse,
      decide: refuse,
      sweep: refuse,
      imageUrl: () => '',
    } as unknown as ReviewClient;
  }

  async function show(client: ReviewClient): Promise<void> {
    await act(async () => {
      root.render(
        <BuildPage
          client={client}
          reviewer="marina"
          route={{ page: 'build', build: 'deploy-7' }}
          go={() => undefined}
        />,
      );
    });
  }

  it('draws the topbar and the way back while it waits', async () => {
    await show(pending(() => new Promise<BuildDetail>(() => undefined)));

    expect(host.querySelector('.va-topbar')).not.toBeNull();
    expect([...host.querySelectorAll('.va-crumb')].map((each) => each.textContent)).toContain(
      'Builds',
    );
    // Bars rather than a sentence, and the sentence kept for whoever is not
    // looking at them.
    expect(host.querySelectorAll('.va-waiting-bar').length).toBeGreaterThan(0);
    expect(host.querySelector('[role="status"]')?.textContent).toContain('Loading');
  });

  it('keeps the way back when the build could not be read at all', async () => {
    await show(pending(() => Promise.reject(new Error('GET /builds/deploy-7 answered 502'))));

    expect(host.textContent).toContain('answered 502');
    expect([...host.querySelectorAll('.va-crumb')].map((each) => each.textContent)).toContain(
      'Builds',
    );
    expect(host.querySelector('.va-failure button')?.textContent).toBe('retry');
  });
});
