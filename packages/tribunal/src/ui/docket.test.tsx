// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { BuildDetail } from '../review-types.js';
import { build, clientThat, subject } from '../__fixtures__/build-page.js';
import type { ReviewClient } from './client.js';
import { BuildPage } from './docket.js';
import type { Route } from './route.js';

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

async function open(
  now: BuildDetail,
  earlier: BuildDetail,
  concerns?: ReviewClient['concerns'],
): Promise<string> {
  await act(async () => {
    root.render(
      <BuildPage
        client={clientThat(now, earlier, concerns)}
        reviewer="marina"
        route={{ page: 'build', build: now.build }}
        go={() => undefined}
      />,
    );
  });
  return host.textContent ?? '';
}

describe('the header counts the concerns the build showed', () => {
  it('counts what stands, and only when something was ever flagged', async () => {
    const asked: unknown[] = [];
    await open(build('6', [subject()]), build('5', [subject()]), async (query) => {
      asked.push(query);
      return { concerns: [], tally: { open: 2, investigating: 1, resolved: 0 } };
    });

    expect(asked).toEqual([{ seenIn: '6' }]);
    // Concerns, and it says so: the Open task beside it counts renders, and a
    // bare "2 open" over a task saying "Open 1" would read as a mistake.
    expect(host.querySelector('.va-topbar .va-concern-tally')?.textContent).toBe(
      'concerns: 2 open · 1 investigating · 0 resolved',
    );
  });

  it('says it could not read them, never that there are none', async () => {
    await open(build('6', [subject()]), build('5', [subject()]), () =>
      Promise.reject(new Error('GET /review/concerns answered 404')),
    );

    const line = host.querySelector('.va-topbar .va-concern-tally');
    expect(line?.textContent).toBe('concerns unread');
    expect(line?.getAttribute('title')).toContain('answered 404');
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

describe('a subject page names the earlier build that kept its image', () => {
  it('opens that build’s page for the same subject', async () => {
    HTMLElement.prototype.scrollTo = () => undefined;
    const now = build('6', [
      subject({
        repeats: {
          count: 1,
          builds: [{ build: '5', at: '2026-06-01T11:00:00.000Z', decision: null }],
        },
      }),
    ]);
    const visited: Route[] = [];
    await act(async () => {
      root.render(
        <BuildPage
          client={clientThat(now, build('5', []))}
          reviewer="marina"
          route={{ page: 'subject', build: '6', subject: 'story:card' }}
          go={(route) => visited.push(route)}
        />,
      );
    });

    const link = host.querySelector<HTMLAnchorElement>('a[href="/builds/5/subjects/story%3Acard"]');
    act(() => link?.click());

    expect(visited).toEqual([{ page: 'subject', build: '5', subject: 'story:card' }]);
  });
});

describe('the bar on a subject walks the rail it sits beside', () => {
  it('numbers the render in the rail’s order and goes to the row below it', async () => {
    // Listed smallest first, so a bar that walked the build's own order would
    // call the larger one second and send the reviewer back up the rail.
    const small = subject({ subject: 'story:small', changedPixels: 10 });
    const large = subject({ subject: 'story:large', changedPixels: 900 });
    const now = build('6', [small, large]);
    const went: Route[] = [];
    Element.prototype.scrollTo = () => undefined;

    await act(async () => {
      root.render(
        <BuildPage
          client={{ ...clientThat(now, build('5', [])), imageBlob: () => new Promise(() => undefined) }}
          reviewer="marina"
          route={{ page: 'subject', build: '6', subject: 'story:large' }}
          go={(route) => went.push(route)}
        />,
      );
    });
    const bar = host.querySelector('.va-actionbar')!;
    await act(async () =>
      [...bar.querySelectorAll('button')].find((each) => each.textContent?.startsWith('Next'))!.click(),
    );

    expect(bar.textContent).toContain('1 of 2');
    expect(went).toEqual([{ page: 'subject', build: '6', subject: 'story:small' }]);
  });
});

describe('an approval on a subject page reads the concerns again', () => {
  it('asks for the build’s concerns once more, since an approval can open one', async () => {
    // Approving an image an earlier build rejected opens a concern. A page that
    // read the build again and not its concerns would keep the old tally.
    Element.prototype.scrollTo = () => undefined;
    let asked = 0;
    const now = build('6', [subject()]);
    const client = {
      ...clientThat(now, build('5', []), async () => {
        asked += 1;
        return { concerns: [], tally: { open: 0, investigating: 0, resolved: 0 } };
      }),
      imageBlob: () => new Promise(() => undefined),
      decide: async () => ({ decision: 'approved', by: 'marina', at: '2026-06-01T12:01:00.000Z', concern: 1 }),
    } as unknown as ReviewClient;

    await act(async () => {
      root.render(
        <BuildPage
          client={client}
          reviewer="marina"
          route={{ page: 'subject', build: '6', subject: 'story:card' }}
          go={() => undefined}
        />,
      );
    });
    const before = asked;
    const approve = [...host.querySelectorAll('button')].find((each) => each.textContent?.trim().startsWith('Approve'));
    await act(async () => approve!.click());

    expect(asked).toBeGreaterThan(before);
  });

  it('shows the concern the approval opened in the subject’s own trail', async () => {
    // The card beside the decision reads its subject's trail once, on arrival.
    // An approval that opened a concern there and left the card as it was
    // would tell the reviewer nothing happened.
    Element.prototype.scrollTo = () => undefined;
    let decided = false;
    const opened = {
      id: 1,
      build: '6',
      subject: 'story:card',
      title: 'Approved the image build 5 rejected',
      evidence: [],
      by: 'marina',
      at: '2026-06-01T12:01:00.000Z',
      state: 'open',
      events: [],
    };
    const now = build('6', [subject()]);
    const client = {
      ...clientThat(now, build('5', []), async () => ({
        concerns: decided ? [opened] : [],
        tally: { open: decided ? 1 : 0, investigating: 0, resolved: 0 },
      })),
      imageBlob: () => new Promise(() => undefined),
      decide: async () => {
        decided = true;
        return { decision: 'approved', by: 'marina', at: '2026-06-01T12:01:00.000Z', concern: 1 };
      },
    } as unknown as ReviewClient;

    await act(async () => {
      root.render(
        <BuildPage
          client={client}
          reviewer="marina"
          route={{ page: 'subject', build: '6', subject: 'story:card' }}
          go={() => undefined}
        />,
      );
    });
    const approve = [...host.querySelectorAll('button')].find((each) => each.textContent?.trim().startsWith('Approve'));
    await act(async () => approve!.click());

    expect(host.querySelector('.va-subject')?.textContent).toContain('Approved the image build 5 rejected');
  });

  it('keeps the trail read after the decision when the first read answers last', async () => {
    // The card's first read can still be on the wire when the decision lands.
    // Answering last, it would put back the trail from before the approval.
    Element.prototype.scrollTo = () => undefined;
    let first: ((answer: unknown) => void) | undefined;
    let reads = 0;
    const opened = {
      id: 1,
      build: '6',
      subject: 'story:card',
      title: 'Approved the image build 5 rejected',
      evidence: [],
      by: 'marina',
      at: '2026-06-01T12:01:00.000Z',
      state: 'open',
      events: [],
    };
    const tally = { open: 0, investigating: 0, resolved: 0 };
    const now = build('6', [subject()]);
    const client = {
      ...clientThat(now, build('5', []), (query: { subject?: string }) => {
        if (query.subject === undefined) return Promise.resolve({ concerns: [], tally });
        reads += 1;
        if (reads === 1) return new Promise((resolve) => (first = resolve));
        return Promise.resolve({ concerns: [opened], tally });
      }),
      imageBlob: () => new Promise(() => undefined),
      decide: async () => ({ decision: 'approved', by: 'marina', at: '2026-06-01T12:01:00.000Z', concern: 1 }),
    } as unknown as ReviewClient;

    await act(async () => {
      root.render(
        <BuildPage
          client={client}
          reviewer="marina"
          route={{ page: 'subject', build: '6', subject: 'story:card' }}
          go={() => undefined}
        />,
      );
    });
    const approve = [...host.querySelectorAll('button')].find((each) => each.textContent?.trim().startsWith('Approve'));
    await act(async () => approve!.click());
    await act(async () => first!({ concerns: [], tally }));

    expect(host.querySelector('.va-subject')?.textContent).toContain('Approved the image build 5 rejected');
  });
});
