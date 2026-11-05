// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Decision, SubjectView } from '../review-types.js';
import type { ReviewClient } from './client.js';
import { SubjectPanel } from './subject.js';

/**
 * What a reviewer reads at the top of a render: its name, its state, and the
 * verdict at the top right. Mounted, because which buttons are live is the point.
 */

function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: 'story:cart',
    verdict: 'changed',
    because: '1,530 pixels differ across 2 regions',
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

const NO_IMAGE = { approvable: false, has: { before: true, after: false, diff: false } };

let host: HTMLDivElement;
let root: Root;

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
});

function clientThat(): ReviewClient & { readonly decided: Decision[] } {
  const decided: Decision[] = [];
  const never = (): Promise<never> => new Promise(() => undefined);
  return {
    decided,
    churn: never,
    reach: never,
    flakiness: never,
    lastChanged: never,
    async decide(_build: string, _on: string, decision: Decision) {
      decided.push(decision);
    },
    concerns: async () => ({ concerns: [], tally: { open: 0, investigating: 0, resolved: 0 } }),
    imageUrl: () => '',
    imageBlob: never,
  } as unknown as ReviewClient & { readonly decided: Decision[] };
}

async function show(on: SubjectView, client: ReviewClient = clientThat()): Promise<void> {
  await act(async () => {
    root.render(
      <SubjectPanel
        client={client}
        reviewer="marina"
        build="ci-1"
        ran="2026-06-01T12:00:00.000Z"
        subject={on}
        place={{ at: 0, of: 2, next: 'story:b' }}
        onGo={() => undefined}
        onDecided={() => undefined}
      />,
    );
  });
}

const head = (): HTMLElement => host.querySelector<HTMLElement>('.va-subject-head')!;
const inHead = (name: string): HTMLButtonElement | undefined =>
  [...head().querySelectorAll('button')].find((each) => each.textContent?.startsWith(name));
const headings = (): (string | null)[] =>
  [...host.querySelectorAll('.va-aside h2')].map((each) => each.textContent);
/** What a reader sees without opening anything. */
function shown(): string {
  const copy = host.cloneNode(true) as HTMLElement;
  copy.querySelectorAll('details').forEach((each) => each.remove());
  return copy.textContent ?? '';
}
const times = (text: string, part: string): number => text.split(part).length - 1;

describe('the verdict sits at the top right of the render', () => {
  it('heads the render, above both the picture and the column, and never in the bar', async () => {
    await show(subject());

    expect(head().parentElement).toBe(host.querySelector('.va-subject'));
    expect(head().compareDocumentPosition(host.querySelector('.va-subject-panes')!)).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
    expect(inHead('Approve')?.className).toContain('va-approve');
    expect(inHead('Reject')).toBeDefined();
    expect(host.querySelector('.va-actionbar')?.textContent).not.toContain('Approve');
    expect(host.querySelector('.va-actionbar')?.textContent).not.toContain('Reject');
  });

  it('leads with Approve and leaves Reject without the primary mark', async () => {
    await show(subject());

    expect(inHead('Reject')?.className).not.toContain('va-approve');
    expect([...head().querySelectorAll('button')].map((each) => each.textContent)).toEqual([
      'Approve',
      'Reject',
    ]);
  });

  it('asks for no verdict on a render nothing is waiting on', async () => {
    // An unchanged render already is its baseline, so there is nothing to accept.
    await show(subject({ verdict: 'unchanged', changedPixels: 0, regions: [] }));

    expect(head().querySelectorAll('button')).toHaveLength(0);
  });
});

describe('a verdict is taken on something the reviewer can see', () => {
  it('offers neither verdict when the run kept no image, and points at why', async () => {
    const client = clientThat();
    await show(subject(NO_IMAGE), client);

    expect(inHead('Approve')?.disabled).toBe(true);
    expect(inHead('Reject')?.disabled).toBe(true);
    const why = inHead('Reject')?.getAttribute('aria-describedby');
    expect(why).toBeTruthy();
    expect(document.getElementById(why!)?.textContent).toContain('no new image');
    expect(inHead('Approve')?.getAttribute('aria-describedby')).toBe(why);

    await act(async () => inHead('Reject')?.click());
    expect(client.decided).toEqual([]);
  });

  it('says the new image is missing even with the baseline on screen', async () => {
    await show(subject(NO_IMAGE));

    expect(shown()).toContain('kept no new image');
    expect(shown()).toContain('Nothing can be approved or rejected');
  });

  it('says the image is missing once, however many controls it stops', async () => {
    await show(subject({ approvable: false, has: { before: false, after: false, diff: false } }));

    expect(times(shown(), 'kept no')).toBe(1);
  });

  it('leaves everything but the verdict live on such a render', async () => {
    await show(subject(NO_IMAGE));
    const bar = host.querySelector('.va-actionbar')!;

    const live = [...bar.querySelectorAll('button')].filter((each) => !each.disabled);
    expect(live.map((each) => each.textContent?.split(' ')[0])).toEqual([
      'Looks',
      'Investigate',
      'Next',
      'Keys',
    ]);
  });

  it('keeps Reject for an image on screen that cannot become a baseline, and says why', async () => {
    await show(subject({ approvable: false }));

    expect(inHead('Approve')?.disabled).toBe(true);
    expect(inHead('Reject')?.disabled).toBe(false);
    expect(head().textContent).toContain('cannot become a baseline');
  });
});

describe('a render already decided shows the decision instead of the choice', () => {
  const by = { by: 'marina', at: '2026-06-01T12:00:00.000Z' };

  it('offers nothing after an approval, which has already moved the baseline', async () => {
    await show(subject({ decision: { decision: 'approved', ...by } }));

    expect(head().textContent).toContain('approved by marina');
    expect(head().querySelectorAll('button')).toHaveLength(0);
  });

  it('offers a rejected render a quiet way to approve it after all', async () => {
    const client = clientThat();
    await show(subject({ decision: { decision: 'rejected', note: 'too wide', ...by } }), client);

    expect(head().textContent).toContain('rejected by marina');
    expect(head().textContent).toContain('too wide');
    expect(inHead('Approve instead')?.className).not.toContain('va-approve');

    await act(async () => inHead('Approve instead')?.click());
    expect(client.decided).toEqual(['approved']);
  });
});

describe('each fact has one home', () => {
  it('states the pixel count once, outside the run’s own folded sentence', async () => {
    await show(subject());

    expect(times(shown(), '1,530')).toBe(1);
    expect(host.querySelector('details .va-said')?.textContent).toContain('1,530 pixels differ');
  });

  it('keeps the run’s sentence in view when nothing else measures the render', async () => {
    await show(subject({ verdict: 'new', changedPixels: 0, regions: [], because: 'nothing to compare it with' }));

    expect(shown()).toContain('nothing to compare it with');
  });

  it('still says what the numbers leave out', async () => {
    await show(subject({ truncated: { regions: 3, pixels: 40 } }));

    expect(host.querySelector('.va-pixels')?.textContent).toContain('3 further regions');
  });

  it('names the render once and offers Looks suspicious once', async () => {
    await show(subject());

    expect(times(shown(), 'story:cart')).toBe(1);
    expect(times(shown(), 'Looks suspicious')).toBe(1);
    expect(shown()).not.toContain('Undecided');
    expect(shown()).not.toContain('Selected');
  });
});

describe('the column carries what has something to say', () => {
  it('draws no card for a list that came back empty', async () => {
    await show(subject({ findings: [], moved: [] }));

    expect(headings()).toEqual(['History']);
  });

  it('keeps every card that has something in it', async () => {
    await show(
      subject({
        moved: [{ component: 'Button', bands: ['geometry'], cause: true }],
        findings: [{ rule: 'label-mismatch', band: 'a11y', headline: 'A label reads wrong', what: 'reads wrong', where: '0/1' }],
      } as unknown as Partial<SubjectView>),
    );

    expect(headings()).toEqual(['What moved', 'Findings', 'History']);
  });

  it('names what was never measured, one line each, and no more', async () => {
    await show(subject());
    const gaps = [...host.querySelectorAll('.va-gaps li')].map((each) => each.textContent);

    expect(headings()).toEqual(['Not measured', 'History']);
    expect(gaps).toHaveLength(2);
    expect(gaps.join(' ')).toContain('no component hashes');
    expect(gaps.join(' ')).toContain('not inspected');
  });

  it('adds no line for a new render, whose verdict already says it has no baseline', async () => {
    await show(
      subject({ verdict: 'new', changedPixels: 0, regions: [], findings: [], has: { before: false, after: true, diff: false } }),
    );

    expect(headings()).toEqual(['History']);
  });

  it('draws the concerns card once something is in it, and when asked for one', async () => {
    await show(subject({ findings: [], moved: [] }));
    expect(headings()).not.toContain('Concerns');

    await act(async () =>
      [...host.querySelectorAll<HTMLButtonElement>('.va-actionbar button')]
        .find((each) => each.textContent?.startsWith('Looks suspicious'))
        ?.click(),
    );

    expect(headings()).toContain('Concerns');
    expect(host.querySelector('form.va-concern-form')).not.toBeNull();
  });
});

describe('words a new reviewer can read', () => {
  it('says what it means when every component matched', async () => {
    await show(subject({ moved: [] }));

    expect(shown()).toContain('No component moved');
    expect(shown()).not.toMatch(/digest|owned it|semantic tier/);
  });
});
