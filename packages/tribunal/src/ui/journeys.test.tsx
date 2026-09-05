import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { JourneysReport } from '@variance-authority/report';
import type { BuildDetail, SubjectView } from '../review-types.js';
import { JourneysPanel, partingsOf } from './journeys.js';

/**
 * The rows, held to the one thing the panel does: turn a module's record round
 * to face each subject without inventing a finding the report did not carry.
 * The failures that read as a working page are a subject listed with nothing
 * to say, and an empty pool drawn as agreement.
 */

const ITEM = 'story:cart-card--item';
const REMOVING = 'story:cart-card--removing';
const QUIET = 'story:cart-card--quiet';

const ON_CLICK = {
  kind: 'function',
  name: 'CartCard/onClick',
  startLine: 51,
  endLine: 58,
  entered: [REMOVING],
  missed: [ITEM],
};

function journeys(overrides: Partial<JourneysReport> = {}): JourneysReport {
  return {
    commit: '4f2a1c9d0b73',
    whole: [ITEM, REMOVING, QUIET],
    truncated: [],
    unrecorded: [],
    found: [
      {
        file: 'app/src/components/CartCard.tsx',
        observers: [ITEM, REMOVING, QUIET],
        parted: [ON_CLICK],
        unentered: [
          { kind: 'branch', name: 'CartCard/empty', startLine: 62, endLine: 64, entered: [], missed: [ITEM, REMOVING, QUIET] },
        ],
      },
    ],
    ...overrides,
  };
}

function subject(overrides: Partial<SubjectView> = {}): SubjectView {
  return {
    subject: ITEM,
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

function build(subjects: readonly SubjectView[], recorded: JourneysReport | null): BuildDetail {
  return {
    project: 'snkr-shop',
    build: '4',
    commit: 'abc1234',
    at: '2026-06-01T12:00:00.000Z',
    identity: { browser: 'chromium', viewport: { width: 1280, height: 800 } } as never,
    retention: 'durable',
    verdicts: { changed: 1, unchanged: 0, new: 0, incomparable: 0, unstable: 0, ignored: 0 },
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
    journeys: recorded,
  };
}

describe('a module row is turned round to face each subject', () => {
  it('puts one region on the entered side of one subject and the missed side of the other', () => {
    const partings = partingsOf(journeys(), []);

    expect(partings.map((parting) => parting.subject)).toEqual([ITEM, REMOVING]);
    expect(partings[1]?.entered).toEqual([
      { file: 'app/src/components/CartCard.tsx', region: ON_CLICK, others: [ITEM] },
    ]);
    expect(partings[0]?.missed).toEqual([
      { file: 'app/src/components/CartCard.tsx', region: ON_CLICK, others: [REMOVING] },
    ]);
  });

  it('lists a changed subject first and a subject that parted from nobody not at all', () => {
    // `QUIET` is in the pool and in the module's observers, and entered exactly
    // what everybody entered. Two empty lists under its name would read as a
    // finding; the pool line is where it is counted.
    const partings = partingsOf(journeys(), [
      subject({ subject: ITEM, verdict: 'unchanged' }),
      subject({ subject: REMOVING, verdict: 'changed' }),
      subject({ subject: QUIET, verdict: 'changed' }),
    ]);

    expect(partings.map((parting) => parting.subject)).toEqual([REMOVING, ITEM]);
  });
});

describe('the panel', () => {
  it('draws nothing for a run that carried no journal', () => {
    expect(renderToStaticMarkup(<JourneysPanel build={build([subject()], null)} />)).toBe('');
  });

  it('names the region, its lines, its file and who was on the other side', () => {
    const html = renderToStaticMarkup(<JourneysPanel build={build([subject()], journeys())} />);

    expect(html).toContain('function CartCard/onClick');
    expect(html).toContain('lines 51–58');
    expect(html).toContain('app/src/components/CartCard.tsx');
    expect(html).toContain(`missed by ${ITEM}`);
    expect(html).toContain(`entered by ${REMOVING}`);
    expect(html).toContain('Regions no subject entered');
    expect(html).toContain('branch CartCard/empty');
    expect(html).toContain('4f2a1c9d0b73');
  });

  it('keeps a pool that cannot hold two apart from a pool that agreed', () => {
    const alone = renderToStaticMarkup(
      <JourneysPanel build={build([subject()], journeys({ whole: [ITEM], found: [] }))} />,
    );
    expect(alone).toContain('nothing here says they agreed');
    expect(alone).not.toContain('same path');

    const agreed = renderToStaticMarkup(
      <JourneysPanel build={build([subject()], journeys({ found: [] }))} />,
    );
    expect(agreed).toContain('took the same path through every module they share');
  });

  it('counts what the journal cut short or never held, beside the pool', () => {
    const html = renderToStaticMarkup(
      <JourneysPanel
        build={build([subject()], journeys({ truncated: ['story:verbose'], unrecorded: ['route/home', 'route/cart'] }))}
      />,
    );

    expect(html).toContain('1 subject cut short');
    expect(html).toContain('2 subjects with no journal at all');
  });
});
