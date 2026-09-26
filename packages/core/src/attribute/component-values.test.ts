import { describe, expect, it } from 'vitest';
import { hashComponents, movedBandsBetween, type ComponentHash } from './component-hash.js';
import { CHROMIUM_PROFILE } from '../format/profile.js';
import type { SemanticNode, SemanticSnapshot } from '../format/snapshot.js';

/**
 * The declared values a component hash carries beside its digests.
 *
 * `style` moving says a component is not styled as it was. The run that holds
 * two sidecars and no documents used to stop there, and a reviewer — or an
 * agent — holding `Button — geometry, token` opened the file and diffed by eye.
 * These tests are the sentence it can say instead: `padding-left 8px → 14px`.
 */

interface Button {
  readonly style: Readonly<Record<string, string>>;
  readonly tokens?: Readonly<Record<string, string>>;
  /** Properties in `style` no declaration set — computed, inherited or initial. */
  readonly computed?: readonly string[];
}

/** A `Card` holding one `Button` per entry, each with its own declarations. */
function page(...buttons: readonly Button[]): SemanticSnapshot {
  const owned = (name: string) => ({ provenance: { owners: [{ name, propsDigest: 'v1:x' }] } });
  const root: SemanticNode = {
    path: '0',
    tag: 'div',
    attributes: {},
    style: { display: 'flex' },
    ...owned('Card'),
    children: buttons.map(
      (button, index): SemanticNode => ({
        path: `0/${index}`,
        tag: 'button',
        attributes: {},
        style: button.style,
        ...(button.tokens === undefined ? {} : { tokens: button.tokens }),
        rect: { x: 0, y: 0, width: 100, height: 36 },
        ...owned('Button'),
        children: [],
      }),
    ),
  };

  return {
    formatVersion: 1,
    subject: { id: 's', kind: 'story' },
    profile: CHROMIUM_PROFILE,
    environment: { semanticDigest: 'v1:e', rasterDigest: 'v1:r', inputs: {} } as never,
    renderHash: 'v1:0',
    structureHash: 'v1:0',
    styleHash: 'v1:0',
    root,
    styleProvenance: buttons.flatMap((button, index) =>
      Object.keys(button.style)
        .filter((property) => !(button.computed ?? []).includes(property))
        .map((property) => ({ path: `0/${index}`, property, sheet: 'ds.css', selector: '.button' })),
    ),
    diagnostics: [],
  };
}

function button(hashes: readonly ComponentHash[]): ComponentHash {
  return hashes.find((entry) => entry.component === 'Button')!;
}

function changedIn(before: SemanticSnapshot, after: SemanticSnapshot) {
  return movedBandsBetween(hashComponents(before), hashComponents(after)).find(
    (entry) => entry.component === 'Button',
  );
}

describe('the values a component hash carries', () => {
  it('keeps each declared value once, in code-unit order, with tokens under their names', () => {
    const hashes = hashComponents(
      page(
        { style: { color: 'rgb(0, 0, 0)', 'padding-left': '8px' }, tokens: { '--accent': '#b5179e' } },
        { style: { color: 'rgb(255, 255, 255)', 'padding-left': '8px' } },
      ),
    );

    expect(button(hashes).values).toEqual({
      '--accent': ['#b5179e'],
      color: ['rgb(0, 0, 0)', 'rgb(255, 255, 255)'],
      'padding-left': ['8px'],
    });
  });

  it('leaves out layout output, which moves with every box', () => {
    // `width` is what the browser computed, not what anybody wrote, and `boxes`
    // already says by how much it changed.
    const hashes = hashComponents(page({ style: { width: '100px', 'padding-left': '8px' } }));

    expect(button(hashes).values).toEqual({ 'padding-left': ['8px'] });
  });

  it('leaves out a value no declaration set', () => {
    // A node's style is the whole allowlist, most of it at initial values.
    // Recording those multiplied a sidecar by six and named nothing anybody wrote.
    const hashes = hashComponents(
      page({ style: { 'padding-left': '8px', 'box-shadow': 'none' }, computed: ['box-shadow'] }),
    );

    expect(button(hashes).values).toEqual({ 'padding-left': ['8px'] });
  });
});

describe('which declaration changed', () => {
  it('names the property and both of its values', () => {
    const moved = changedIn(
      page({ style: { 'padding-left': '8px', 'padding-right': '8px' } }),
      page({ style: { 'padding-left': '14px', 'padding-right': '8px' } }),
    );

    expect(moved?.changed).toEqual([{ property: 'padding-left', from: ['8px'], to: ['14px'] }]);
  });

  it('names only the value that moved when instances declare different ones', () => {
    // Primary and secondary on one page. The secondary background changed and
    // the primary did not, so the primary's value is on neither side.
    const moved = changedIn(
      page({ style: { background: 'blue' } }, { style: { background: 'white' } }),
      page({ style: { background: 'blue' } }, { style: { background: 'rgb(240, 240, 240)' } }),
    );

    expect(moved?.changed).toEqual([
      { property: 'background', from: ['white'], to: ['rgb(240, 240, 240)'] },
    ]);
  });

  it('names a token by its custom property', () => {
    const moved = changedIn(
      page({ style: { color: '#b5179e' }, tokens: { '--accent': '#b5179e' } }),
      page({ style: { color: '#4f46e5' }, tokens: { '--accent': '#4f46e5' } }),
    );

    expect(moved?.changed).toEqual([
      { property: '--accent', from: ['#b5179e'], to: ['#4f46e5'] },
      { property: 'color', from: ['#b5179e'], to: ['#4f46e5'] },
    ]);
  });

  it('reports a property no node declared before with an empty side', () => {
    // The computed value was there all along; what changed is that somebody
    // wrote it down.
    const moved = changedIn(
      page({ style: { 'box-shadow': '0 1px 2px black' }, computed: ['box-shadow'] }),
      page({ style: { 'box-shadow': 'none' } }),
    );

    expect(moved?.changed).toEqual([{ property: 'box-shadow', from: [], to: ['none'] }]);
  });

  it('says nothing when the values traded places between instances', () => {
    // The digest moved and every property's set of values held. That is a real
    // change this record cannot describe, and an empty list would say there was
    // none.
    const moved = changedIn(
      page({ style: { background: 'blue' } }, { style: { background: 'white' } }),
      page({ style: { background: 'white' } }, { style: { background: 'blue' } }),
    );

    expect(moved?.bands).toEqual(['token']);
    expect(moved && 'changed' in moved).toBe(false);
  });

  it('says nothing against a baseline written before values were recorded', () => {
    const { values: _dropped, ...old } = button(hashComponents(page({ style: { color: 'red' } })));
    const [moved] = movedBandsBetween(
      [old],
      [button(hashComponents(page({ style: { color: 'blue' } })))],
    );

    expect(moved?.bands).toEqual(['token']);
    expect(moved && 'changed' in moved).toBe(false);
  });
});
