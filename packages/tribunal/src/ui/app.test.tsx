// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core';
import type { Flakiness } from '@variance-authority/history';
import type { BuildSummary, SubjectView } from '../review.js';
import type { ReviewClient } from './client.js';
import { ReviewApp, SubjectHistory } from './review.js';

/**
 * The three states `ReviewApp` itself decides between, and the one that matters.
 *
 * [`review.test.tsx`](./review.test.tsx) covers every piece this component
 * arranges and could not cover the arrangement: those are static renders, and
 * the whole of this component's own logic lives in an effect. So it is mounted
 * here, in jsdom, which is the only way to reach the branch where the fetch
 * *failed* — and that branch is the reason the component is worth testing at
 * all. An empty list and a list that could not be loaded look identical, and one
 * of them is the sentence somebody merges on.
 */

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@131',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: [],
};

function build(id: string): BuildSummary {
  return {
    project: 'shop',
    build: id,
    commit: 'abcdef1234567890',
    at: '2026-08-01T10:00:00.000Z',
    identity: IDENTITY,
    retention: 'durable',
    verdicts: {
      unchanged: 4,
      changed: 1,
      new: 0,
      ignored: 0,
      incomparable: 0,
      unstable: 0,
      failed: 0,
    },
    decided: 0,
    pending: 1,
    coverage: { stated: true, failed: 0, excluded: 0, unreached: 0 },
  };
}

/** Everything but `builds` throws: this component is not allowed to call them. */
function clientThat(builds: () => Promise<readonly BuildSummary[]>): ReviewClient {
  const refuse = (): never => {
    throw new Error('the build list is the only call this state may make');
  };

  return {
    builds,
    build: refuse,
    changelog: refuse,
    churn: refuse,
    reach: refuse,
    flakiness: refuse,
    lastChanged: refuse,
    decide: refuse,
    sweep: refuse,
    imageUrl: () => '',
  };
}

/** A client that answers history and refuses everything a panel must not call. */
function historyClient(flakiness: () => Promise<Flakiness>): ReviewClient {
  const refuse = (): never => {
    throw new Error('a subject panel asks about the record and nothing else');
  };

  return {
    builds: refuse,
    build: refuse,
    changelog: refuse,
    churn: refuse,
    reach: refuse,
    flakiness,
    lastChanged: refuse,
    decide: refuse,
    sweep: refuse,
    imageUrl: () => '',
  };
}

function subject(): SubjectView {
  return {
    subject: 'story:card',
    verdict: 'changed',
    because: 'the rendered image differs from the baseline',
    changedPixels: 12,
    // No cause attributed, so churn and reach are not asked for — which is why
    // `historyClient` can refuse them and this still renders.
    regions: [],
    has: { before: true, after: true, diff: true },
    approvable: true,
    decision: null,
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

async function mount(client: ReviewClient): Promise<void> {
  await act(async () => {
    root.render(<ReviewApp client={client} reviewer="marina" />);
  });
}

describe('ReviewApp', () => {
  it('reports a build list it could not load, and never as an empty one', async () => {
    // The failure this component exists to prevent. `No builds have been posted
    // yet` over a service that answered 503 is a green light nobody gave, and it
    // is indistinguishable from the true version of the same sentence.
    await mount(
      clientThat(() => Promise.reject(new Error('GET /builds answered 503: upstream is down'))),
    );

    expect(host.textContent).toContain('upstream is down');
    expect(host.textContent).not.toContain('No builds have been posted yet');
    // And a way back: a failure with no retry is a page reload.
    expect(host.querySelector('.va-failure button')?.textContent).toBe('retry');
  });

  it('says the list is empty only when the service said so', async () => {
    await mount(clientThat(() => Promise.resolve([])));

    expect(host.textContent).toContain('No builds have been posted yet');
  });

  it('lists what came back, and asks the service once', async () => {
    let calls = 0;
    await mount(
      clientThat(() => {
        calls += 1;
        return Promise.resolve([build('run-41'), build('run-42')]);
      }),
    );

    expect(calls).toBe(1);
    expect([...host.querySelectorAll('.va-build-id')].map((node) => node.textContent)).toEqual([
      'run-41',
      'run-42',
    ]);
  });
});

describe('SubjectHistory', () => {
  const flakiness: Flakiness = {
    subject: 'story:card',
    window: {},
    runs: 20,
    sweeps: 20,
    occurrences: 6,
    absorbedRuns: 0,
    rate: 0.3,
    sweepsSince: 9,
    causes: [],
    omittedRuns: 0,
    omittedOccurrences: 0,
  };

  it('asks nothing until a reviewer asks, because a build has three hundred of these', async () => {
    let calls = 0;
    const client = historyClient(() => {
      calls += 1;
      return Promise.resolve(flakiness);
    });

    await act(async () => {
      root.render(<SubjectHistory client={client} subject={subject()} />);
    });

    expect(calls).toBe(0);
    expect(host.querySelector('.va-ask')?.textContent).toBe('Has this changed before?');

    await act(async () => {
      host.querySelector<HTMLButtonElement>('.va-ask')?.click();
    });

    expect(calls).toBe(1);
    expect(host.textContent).toContain('none in the last 9 sweeps');
  });

  it('reports a record it could not read, rather than a subject with no history', async () => {
    // The same failure as the build list, one level down: "this has never been
    // unstable" is the sentence somebody approves on, and it is what an error
    // swallowed here would say.
    const client = historyClient(() =>
      Promise.reject(new Error('GET /v1/flakiness answered 500: no such table')),
    );

    await act(async () => {
      root.render(<SubjectHistory client={client} subject={subject()} />);
    });
    await act(async () => {
      host.querySelector<HTMLButtonElement>('.va-ask')?.click();
    });

    expect(host.textContent).toContain('no such table');
    expect(host.textContent).not.toContain('never disagreed');
  });
});
