import { describe, expect, it } from 'vitest';
import { heldDigest } from '../format/provenance.js';
import type { Holding } from '../format/holding.js';
import { capture, node } from '../rules/normalize/fixture.js';
import { normalize } from '../rules/normalize/index.js';
import type { RawCapture } from '../format/capture.js';
import { partingOf } from './parting.js';
import { explainParting } from './explain.js';

const snap = (raw: RawCapture) => normalize(raw);
const part = (base: RawCapture, other: RawCapture) => partingOf(snap(base), snap(other));

/** A hook cell as the React reader emits one: authored call index, name, digest. */
const cell = (index: number, hook: string, value: unknown) => ({
  index,
  hook,
  digest: heldDigest(value),
});

const held = (name: string, value: unknown) => ({ name, digest: heldDigest(value) });

/**
 * `Cart` renders `Summary`, which renders one tag or the other.
 *
 * The whole ladder in one fixture: a hook cell on `Cart`, a prop on `Summary`,
 * and a tag that follows from both. Everything below asks which of the three a
 * reader is handed.
 */
function tree(options: {
  readonly expanded: boolean;
  readonly cart?: Holding;
  readonly summary?: Holding;
}) {
  const { expanded } = options;
  return capture({
    subjectId: 'story:cart--default',
    root: node({
      tag: 'div',
      owners: [{ name: 'Cart' }],
      holding: options.cart ?? { cells: [cell(0, 'useState', expanded)], props: [] },
      children: [
        node({
          tag: expanded ? 'p' : 'span',
          text: expanded ? '3 items in your cart' : '3',
          owners: [{ name: 'Summary' }, { name: 'Cart' }],
          holding: options.summary ?? { cells: [], props: [held('expanded', expanded)] },
        }),
      ],
    }),
  });
}

describe('the rung a reading reaches', () => {
  it('names the hook cell that moved, not the tag that followed', () => {
    // The finding. A diff says `p` became `span`; this says `Cart`'s first
    // `useState` moved and everything else is downstream of it.
    const parting = part(tree({ expanded: false }), tree({ expanded: true }));

    expect(parting.origins?.map((entry) => entry.component)).toEqual(['Cart']);

    const origin = parting.origins![0]!;
    expect(origin.rung).toBe('stateful');
    expect(origin.inputs).toEqual([
      { kind: 'hook', name: 'useState', index: 0, from: expect.any(String), to: expect.any(String) },
    ]);
  });

  it('reports the component below it as handed a named prop, not as a cause', () => {
    const parting = part(tree({ expanded: false }), tree({ expanded: true }));
    const summary = parting.boundaries!.find((entry) => entry.component === 'Summary')!;

    expect(summary.rung).toBe('handed');
    expect(summary.inputs.map((input) => input.name)).toEqual(['expanded']);
    expect(parting.origins).toHaveLength(1);
  });

  it('pairs a boundary whose own tag changed, which no host matcher can', () => {
    // `Summary` returns a `<span>` where it returned a `<p>`. Every identity key
    // in `match.ts` ends in the tag, so the pair is unreachable there — and it is
    // the pair carrying the prop that explains the branch.
    const summary = part(tree({ expanded: false }), tree({ expanded: true })).boundaries!.find(
      (entry) => entry.component === 'Summary',
    )!;

    expect(summary.rung).not.toBe('unpaired');
  });

  it('speaks the origin and hangs its manifestations under it', () => {
    const lines = explainParting(part(tree({ expanded: false }), tree({ expanded: true })));

    expect(lines[0]).toBe('variation — an input moved and the page followed');
    expect(lines[1]).toBe('Cart chose differently — useState #0 moved');
    expect(lines).toContain('  manifests as Summary was handed a different `expanded`');
  });
});

describe('a store that moved outside React', () => {
  it('separates an external subscription from a component’s own state', () => {
    const store = (arm: string): Holding => ({
      cells: [cell(0, 'useSyncExternalStore', { arm })],
      props: [],
    });
    const parting = part(
      tree({ expanded: false, cart: store('control') }),
      tree({ expanded: true, cart: store('treatment') }),
    );

    // The row that covers every store in the ecosystem: Redux, Zustand, Jotai and
    // a URL all reach React through this one hook, so one rung reads all of them.
    expect(parting.origins![0]!.rung).toBe('external');
  });
});

describe('what this refuses to claim', () => {
  it('will not call a render nondeterministic when the hooks were unreadable', () => {
    // A production build populates no hook names. Absent cells, not empty ones —
    // and the accusation is withheld, because it is an accusation about inputs
    // nobody read (ADR-0002).
    const blind: Holding = { props: [] };
    const parting = part(
      tree({ expanded: false, cart: blind, summary: blind }),
      tree({ expanded: true, cart: blind, summary: blind }),
    );

    expect(parting.boundaries!.map((entry) => entry.rung)).not.toContain('undetermined');
    expect(parting.boundaries!.map((entry) => entry.rung)).toContain('unread');
    expect(parting.origins).toBeUndefined();
  });

  it('calls a render nondeterministic only when every input was read and agreed', () => {
    // Two readings of one page, same state, different output: the flake, named.
    const same: Holding = { cells: [cell(0, 'useState', false)], props: [] };
    const parting = part(
      tree({ expanded: false, cart: same, summary: { cells: [], props: [] } }),
      tree({ expanded: true, cart: same, summary: { cells: [], props: [] } }),
    );

    expect(parting.origins!.map((entry) => entry.rung)).toContain('undetermined');
  });

  it('says nothing about boundaries on a page that carried no holding', () => {
    const plain = (text: string) =>
      capture({ subjectId: 'story:plain--default', root: node({ tag: 'p', text }) });
    const parting = part(plain('one'), plain('two'));

    expect(parting.boundaries).toBeUndefined();
    expect(parting.deltas.length).toBeGreaterThan(0);
    expect(parting.slice).toBe('unread');
    expect(explainParting(parting)).toEqual([
      'unread — the page moved and no boundary could be read',
      '  no framework boundary was read, so nothing can be said about why',
    ]);
  });

  it('reports an arm that was assigned differently and rendered the same', () => {
    // The negative result an experiment actually wants, and the one a diff cannot
    // express: the state moved, the pixels did not.
    const quiet = (arm: string): Holding => ({
      cells: [cell(0, 'useState', arm)],
      props: [],
    });
    const parting = part(
      tree({ expanded: false, cart: quiet('control') }),
      tree({ expanded: false, cart: quiet('treatment') }),
    );

    expect(parting.identical).toBe(true);
    expect(parting.slice).toBe('absorbed');
    const cart = parting.boundaries!.find((entry) => entry.component === 'Cart')!;
    expect(cart.rung).toBe('stateful');
    expect(cart.deltas).toBe(0);
    expect(explainParting(parting)).toContain('  and rendered the same anyway');
  });
});
