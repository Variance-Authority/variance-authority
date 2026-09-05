import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import type { JourneysReport, VariationRecord } from '@variance-authority/report';
import type { BuildDetail, SubjectView } from '../review-types.js';
import { familiesOf, JourneysPanel } from './journeys.js';

/**
 * The rows, held to the one thing the panel decides: cut the module record into
 * families and keep only the rows a family is split on, without inventing a
 * finding the report did not carry. The failures that read as a working page
 * are a family split by a region it agreed on, and an empty pool drawn as
 * agreement. The tree grown from the rows has its own test.
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

function build(
  subjects: readonly SubjectView[],
  recorded: JourneysReport | null,
  variations: readonly VariationRecord[] = [],
): BuildDetail {
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
    variations,
    reach: null,
    journeys: recorded,
  };
}

describe('a family is split only by what its own stories did differently', () => {
  it('puts a region one sibling entered and another missed on one row, a cell per sibling', () => {
    const [family] = familiesOf(journeys(), []);

    expect(family?.name).toBe('story:cart-card');
    expect(family?.columns.map((column) => column.member)).toEqual(['item', 'quiet', 'removing']);
    // `QUIET` observes the module and is on neither side of the region: the
    // report left it out, so the grid does too, and it is not a `missed`.
    expect(family?.rows).toEqual([
      { file: 'app/src/components/CartCard.tsx', region: ON_CLICK, cells: ['missed', 'absent', 'entered'] },
    ]);
  });

  it('is not split by a region it agrees on, whichever other family it parts from', () => {
    const CONTROL = 'story:product-card--control';
    const SALE = 'story:product-card--sale';
    const families = familiesOf(
      journeys({
        whole: [ITEM, REMOVING, CONTROL, SALE],
        found: [
          {
            file: 'app/src/components/ui/card.tsx',
            observers: [ITEM, REMOVING, CONTROL, SALE],
            parted: [
              { ...ON_CLICK, name: 'forwardRef.arg0', entered: [CONTROL, SALE], missed: [ITEM, REMOVING] },
            ],
            unentered: [],
          },
        ],
      }),
      [],
    );

    expect(families.map((family) => [family.name, family.rows.length])).toEqual([
      ['story:cart-card', 0],
      ['story:product-card', 0],
    ]);
  });

  it('rows the module itself when part of the family never entered it', () => {
    const [family] = familiesOf(
      journeys({
        found: [{ file: 'app/src/components/Undo.tsx', observers: [REMOVING], parted: [], unentered: [] }],
      }),
      [],
    );

    expect(family?.rows).toEqual([
      { file: 'app/src/components/Undo.tsx', region: null, cells: ['missed', 'missed', 'entered'] },
    ]);
  });

  it('orders the columns by the lattice, an arm after what it varies from', () => {
    const CONTROL = 'story:product-card--control';
    const DARK = 'story:product-card--control-dark';
    const SALE = 'story:product-card--sale';
    const SALE_DARK = 'story:product-card--sale-dark';
    const [family] = familiesOf(journeys({ whole: [SALE_DARK, SALE, DARK, CONTROL], found: [] }), [
      { subject: SALE, parent: CONTROL },
      { subject: DARK, parent: CONTROL },
      { subject: SALE_DARK, parent: SALE },
    ]);

    expect(family?.columns).toEqual([
      { subject: CONTROL, member: 'control' },
      { subject: SALE, member: 'sale', from: 'control' },
      { subject: SALE_DARK, member: 'sale-dark', from: 'sale' },
      { subject: DARK, member: 'control-dark', from: 'control' },
    ]);
  });

  it('leads with the shortest name where the run read no lattice, then the name', () => {
    const whole = ['loading', 'error', 'empty', 'full'].map((member) => `story:panel--${member}`);
    const [family] = familiesOf(journeys({ whole, found: [] }), []);

    expect(family?.columns.map((column) => column.member)).toEqual(['full', 'empty', 'error', 'loading']);
  });
});

describe('the panel', () => {
  it('draws nothing for a run that carried no journal', () => {
    expect(renderToStaticMarkup(<JourneysPanel build={build([subject()], null)} />)).toBe('');
  });

  it('draws the family as a timeline, and lists each fork with its full coordinate', () => {
    const html = renderToStaticMarkup(<JourneysPanel build={build([subject()], journeys())} />);

    expect(html).toContain('<h3>story:cart-card</h3>');
    expect(html).toContain('<svg class="va-timeline"');
    expect(html).toContain('CartCard/onClick:51');
    expect(html).toContain('class="va-timeline-line va-lit"');
    expect(html).toContain('class="va-timeline-line va-dim"');
    expect(html).toContain('<title>story:cart-card--removing</title>');
    expect(html).toContain('function CartCard/onClick');
    expect(html).toContain('lines 51–58');
    expect(html).toContain('app/src/components/CartCard.tsx');
    expect(html).toContain('1 region no subject entered');
    expect(html).toContain('branch CartCard/empty');
    expect(html).toContain('4f2a1c9d0b73');
  });

  it('keeps a pool that cannot hold two apart from a family that agreed', () => {
    const alone = renderToStaticMarkup(
      <JourneysPanel build={build([subject()], journeys({ whole: [ITEM], found: [] }))} />,
    );
    expect(alone).toContain('nothing to compare');
    expect(alone).not.toContain('one path');

    const agreed = renderToStaticMarkup(
      <JourneysPanel build={build([subject()], journeys({ found: [] }))} />,
    );
    expect(agreed).toContain('stories took one path through every module they share');
    expect(agreed).toContain('<code>story:cart-card</code> (3 subjects)');
  });

  it('counts a story with no sibling apart from a family that agreed', () => {
    const html = renderToStaticMarkup(
      <JourneysPanel build={build([subject()], journeys({ whole: [ITEM, REMOVING, 'story:footer--only'], found: [] }))} />,
    );

    expect(html).toContain('1 subject is the only story of its component');
    expect(html).toContain('<code>story:cart-card</code> (2 subjects)');
  });

  it('counts what the journal cut short or never held, beside the pool', () => {
    const html = renderToStaticMarkup(
      <JourneysPanel
        build={build([subject()], journeys({ truncated: ['story:verbose'], unrecorded: ['route/home', 'route/cart'] }))}
      />,
    );

    expect(html).toContain('1 subject with a journal that ended early');
    expect(html).toContain('2 subjects with no journal at all');
  });
});
