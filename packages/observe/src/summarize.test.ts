import { describe, expect, it } from 'vitest';
import { indexSource } from '@variance-authority/core';
import type { AttributedRegion } from '@variance-authority/core';
import type { Observation } from './observe.js';
import { summarizeObservation } from './summarize.js';

/**
 * The one string a caller who never runs the CLI is handed.
 *
 * `@variance-authority/playwright-test` asserts the same function through its own
 * seam, because *what a failing assertion prints* is that package's contract.
 * What is held here is the part neither the CLI nor an assertion message covers:
 * a region nothing could attribute, and an instance line beating a declaration.
 */

const SOURCE = indexSource(
  'src/ds/components.tsx',
  'export function Toggle() {\n  return null;\n}\n',
);

function observation(regions: readonly AttributedRegion[]): Observation {
  return {
    subject: 'cart/empty',
    verdict: 'changed',
    because: '1530 pixels differ',
    regions,
    rendered: true,
    missingFonts: [],
  };
}

function at(x: number, y: number, pixels: number): AttributedRegion['region'] {
  return { x, y, width: 10, height: 10, pixels, density: pixels / 100 };
}

describe('summarizeObservation', () => {
  it('gives an address only where it has no name to give', () => {
    // The loud case. A region outside the tree entirely almost always means the
    // scale or the origin was wrong, and a reader who is handed `unattributed`
    // with no coordinate cannot check that.
    const message = summarizeObservation(
      observation([
        {
          region: at(4, 8, 86),
          unattributed: true,
          nearest: { path: [0], component: 'Card' },
        },
        { region: at(0, 40, 40), component: 'Toggle', unattributed: false },
      ]),
    );

    expect(message).toContain('86px — unattributed at 4,8 (nearest: Card)');
    // And the named one is not given an address it does not need.
    expect(message.endsWith('40px — Toggle')).toBe(true);
    expect(message).not.toContain('Toggle at');
  });

  it("prefers the element's own line to the component's declaration", () => {
    // Two different answers. Resolving `Toggle` says where `Toggle` is declared,
    // which is the same line for every instance of it; the element's own line
    // says which instance moved.
    const message = summarizeObservation(
      observation([
        {
          region: at(0, 0, 86),
          component: 'Toggle',
          unattributed: false,
          source: { file: 'src/app/cart.tsx', line: 42 },
        },
      ]),
      { source: SOURCE },
    );

    expect(message).toContain('src/app/cart.tsx:42');
    expect(message).not.toContain('src/ds/components.tsx');
  });

  it('says the ordering is displacement rather than blame', () => {
    // An `Observation` carries no causes, so area is all there is — and an
    // unqualified ranking by area is a claim about cause that nothing computed.
    const message = summarizeObservation(
      observation([
        { region: at(0, 0, 86), component: 'Toggle', unattributed: false },
        { region: at(0, 40, 511), component: 'Stack', unattributed: false },
      ]),
    );

    expect(message.indexOf('Stack')).toBeLessThan(message.indexOf('Toggle'));
    expect(message).toContain('measures displacement rather than blame');
  });

  it('is one line when there is nothing to point at', () => {
    expect(summarizeObservation(observation([]))).toBe(
      'cart/empty: changed — 1530 pixels differ',
    );
  });
});
