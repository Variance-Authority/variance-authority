// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import type { ReactElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Concern, ConcernTally, RaiseConcern } from '../concern-types.js';
import type { SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { ConcernTrail, Concerns, ConcernTallyLine, evidenceFor, useConcernTally } from './concerns.js';

/**
 * "Looks suspicious", on the subject page: the form that raises a concern, the
 * trail that keeps it, and the line on the build that counts them.
 *
 * Mounted in jsdom for the part that is an effect — loading, raising, moving —
 * and rendered statically for the parts that are a function of a value.
 */

const SUBJECT: SubjectView = {
  subject: 'story:cart--summary',
  verdict: 'changed',
  because: 'the rendered image differs from the baseline',
  changedPixels: 120,
  regions: [
    { x: 10, y: 20, width: 30, height: 8, pixels: 90, component: 'CartSummary', file: 'src/CartSummary.tsx:84', cause: true },
    { x: 0, y: 40, width: 100, height: 4, pixels: 30, component: 'Banner', cause: false },
  ],
  has: { before: true, after: true, diff: true },
  approvable: true,
  decision: null,
};

const RAISED: Concern = {
  id: 7,
  build: 'ci-1001',
  subject: SUBJECT.subject,
  title: 'Total moved below the fold',
  region: { x: 10, y: 20, width: 30, height: 8 },
  evidence: ['CartSummary'],
  by: 'marina',
  at: '2026-08-01T10:00:00.000Z',
  state: 'open',
  events: [{ state: 'open', by: 'marina', at: '2026-08-01T10:00:00.000Z', hypothesis: 'The banner gained a margin' }],
};

describe('evidenceFor', () => {
  it('offers what the regions name, causes first, once each, then the baseline', () => {
    expect(evidenceFor(SUBJECT)).toEqual(['CartSummary', 'src/CartSummary.tsx:84', 'Banner', 'baseline']);
  });
});

describe('ConcernTrail', () => {
  it('says what was suspected, where, on what, and every step since', () => {
    const html = renderToStaticMarkup(
      <ConcernTrail
        concern={{
          ...RAISED,
          state: 'investigating',
          events: [...RAISED.events, { state: 'investigating', by: 'anton', at: '2026-08-01T11:00:00.000Z', note: 'Looking' }],
        }}
        build="ci-1001"
        busy={false}
        onMove={() => undefined}
      />,
    );
    expect(html).toContain('Total moved below the fold');
    expect(html).toContain('investigating');
    expect(html).toContain('CartSummary');
    expect(html).toContain('30×8 at 10,20');
    expect(html).toContain('The banner gained a margin');
    expect(html).toContain('anton');
    expect(html).toContain('Looking');
    expect(html).toContain('Resolve');
    expect(html).not.toContain('raised in');
  });

  it('names the build a concern was raised in when it is not this one', () => {
    const html = renderToStaticMarkup(
      <ConcernTrail concern={RAISED} build="ci-1002" busy={false} onMove={() => undefined} />,
    );
    expect(html).toContain('raised in ci-1001');
  });

  it('offers to reopen a resolved concern, and nothing else', () => {
    const html = renderToStaticMarkup(
      <ConcernTrail concern={{ ...RAISED, state: 'resolved' }} build="ci-1001" busy={false} onMove={() => undefined} />,
    );
    expect(html).toContain('Reopen');
    expect(html).not.toContain('Investigate');
  });
});

describe('ConcernTallyLine', () => {
  it('counts what stands, and says nothing when nothing was ever flagged', () => {
    expect(renderToStaticMarkup(<ConcernTallyLine tally={{ open: 2, investigating: 1, resolved: 0 }} />)).toContain(
      '2 flagged',
    );
    expect(renderToStaticMarkup(<ConcernTallyLine tally={{ open: 0, investigating: 0, resolved: 0 }} />)).toBe('');
  });
});

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

/** A client that keeps concerns in memory and refuses everything else. */
function concernClient(listed: () => Promise<readonly Concern[]>): ReviewClient & { readonly raised: RaiseConcern[] } {
  const refuse = (): never => {
    throw new Error('the concerns panel reads and writes concerns and nothing else');
  };
  const raised: RaiseConcern[] = [];
  let kept: Concern[] = [];
  return {
    raised,
    builds: refuse,
    build: refuse,
    changelog: refuse,
    churn: refuse,
    reach: refuse,
    flakiness: refuse,
    lastChanged: refuse,
    decide: refuse,
    sweep: refuse,
    concerns: async () => ({ concerns: [...(await listed()), ...kept] }),
    async raise(input) {
      raised.push(input);
      const concern: Concern = { ...RAISED, title: input.title, evidence: input.evidence ?? [] };
      kept = [...kept, concern];
      return concern;
    },
    async moveConcern(id, input) {
      kept = kept.map((each) => (each.id === id ? { ...each, state: input.state } : each));
      return kept.find((each) => each.id === id)!;
    },
    imageUrl: () => '',
    imageBlob: refuse,
  };
}

function type(input: HTMLInputElement | HTMLTextAreaElement, value: string): void {
  const prototype = input instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
  act(() => {
    Object.getOwnPropertyDescriptor(prototype, 'value')!.set!.call(input, value);
    input.dispatchEvent(new Event('input', { bubbles: true }));
  });
}

async function mount(client: ReviewClient): Promise<void> {
  await act(async () => {
    root.render(<Concerns client={client} reviewer="marina" build="ci-1001" subject={SUBJECT} />);
  });
}

describe('Concerns', () => {
  it('raises what the reviewer wrote, on the region and evidence they chose', async () => {
    const client = concernClient(async () => []);
    await mount(client);
    expect(host.textContent).toContain('Nobody has flagged this render');

    await act(async () => host.querySelector<HTMLButtonElement>('.va-suspicious')!.click());
    type(host.querySelector<HTMLInputElement>('input[name="title"]')!, 'Total moved below the fold');
    type(host.querySelector<HTMLTextAreaElement>('textarea[name="note"]')!, 'Under the banner now');
    await act(async () => {
      const scope = host.querySelector<HTMLSelectElement>('select[name="region"]')!;
      scope.value = '0';
      scope.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('.va-evidence button')].find((b) => b.textContent === 'Banner')!.click(),
    );
    await act(async () => host.querySelector<HTMLFormElement>('form.va-concern-form')!.requestSubmit());

    expect(client.raised).toEqual([
      {
        build: 'ci-1001',
        subject: SUBJECT.subject,
        title: 'Total moved below the fold',
        by: 'marina',
        note: 'Under the banner now',
        region: { x: 10, y: 20, width: 30, height: 8 },
        evidence: ['Banner'],
        state: 'open',
      },
    ]);
    expect(host.textContent).toContain('Total moved below the fold');
    expect(host.querySelector('form.va-concern-form')).toBeNull();
  });

  it('refuses to save a concern with no title, on the page rather than at the server', async () => {
    const client = concernClient(async () => []);
    await mount(client);
    await act(async () => host.querySelector<HTMLButtonElement>('.va-suspicious')!.click());
    await act(async () => host.querySelector<HTMLFormElement>('form.va-concern-form')!.requestSubmit());

    expect(client.raised).toEqual([]);
    expect(host.querySelector<HTMLButtonElement>('form.va-concern-form button[type="submit"]')!.disabled).toBe(true);
  });

  it('moves a concern and draws the state it landed in', async () => {
    const client = concernClient(async () => []);
    await mount(client);
    await act(async () => host.querySelector<HTMLButtonElement>('.va-suspicious')!.click());
    type(host.querySelector<HTMLInputElement>('input[name="title"]')!, 'Spacing');
    await act(async () => host.querySelector<HTMLFormElement>('form.va-concern-form')!.requestSubmit());

    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('.va-concern button')].find((b) => b.textContent === 'Resolve')!.click(),
    );
    expect(host.querySelector('.va-concern-state')?.textContent).toBe('resolved');
  });

  it('reports concerns it could not load, and never as none', async () => {
    await mount(concernClient(() => Promise.reject(new Error('GET /review/concerns answered 503'))));
    expect(host.textContent).toContain('answered 503');
    expect(host.textContent).not.toContain('Nobody has flagged');
  });
});

describe('useConcernTally', () => {
  function Tally({ client, build }: { readonly client: ReviewClient; readonly build: string }): ReactElement {
    return <ConcernTallyLine tally={useConcernTally(client, build).tally} />;
  }

  it('never draws the tally of a build the page has left', async () => {
    // The first build answers last. A header that kept whichever answer came
    // in last would count the wrong build's concerns under this one's name.
    let late: (tally: ConcernTally) => void = () => undefined;
    const answers: Record<string, Promise<{ concerns: readonly Concern[]; tally: ConcernTally }>> = {
      '1': new Promise((resolve) => (late = (tally) => resolve({ concerns: [], tally }))),
      '2': Promise.resolve({ concerns: [], tally: { open: 2, investigating: 0, resolved: 0 } }),
    };
    const client = { ...concernClient(async () => []), concerns: ({ seenIn }: { seenIn?: string }) => answers[seenIn!]! };

    await act(async () => root.render(<Tally client={client} build="1" />));
    await act(async () => root.render(<Tally client={client} build="2" />));
    await act(async () => late({ open: 9, investigating: 0, resolved: 0 }));

    expect(host.textContent).toContain('2 flagged');
  });
});

describe('Concerns, across subjects', () => {
  it('never lands a write on the subject the reviewer moved to while it was in flight', async () => {
    // The subject page keeps one panel for every subject, so a raise that answers
    // after the reviewer moved on must not appear in the next subject's trail.
    let land: (concern: Concern) => void = () => undefined;
    const client: ReviewClient = {
      ...concernClient(async () => []),
      raise: () => new Promise<Concern>((resolve) => (land = resolve)),
    };
    const other: SubjectView = { ...SUBJECT, subject: 'story:cart--empty' };
    const show = (subject: SubjectView): Promise<void> =>
      act(async () => root.render(<Concerns client={client} reviewer="marina" build="ci-1001" subject={subject} />));

    await show(SUBJECT);
    await act(async () => host.querySelector<HTMLButtonElement>('.va-suspicious')!.click());
    type(host.querySelector<HTMLInputElement>('input[name="title"]')!, 'Spacing');
    await act(async () => host.querySelector<HTMLFormElement>('form.va-concern-form')!.requestSubmit());
    await show(other);
    await act(async () => land({ ...RAISED, title: 'Spacing' }));

    expect(host.textContent).not.toContain('Spacing');
    expect(host.textContent).toContain('Nobody has flagged this render');
  });
});
