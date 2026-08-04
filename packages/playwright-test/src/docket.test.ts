import { describe, expect, it } from 'vitest';
import { indexSource } from '@variance-authority/core';
import type { AttributedRegion } from '@variance-authority/core';
import type { Observation } from '@variance-authority/observe';
import { describeObservation } from './docket.js';

/**
 * What a reader is handed when an assertion fails.
 *
 * Asserted here rather than through Playwright because the message is the only
 * part of this package with an opinion in it, and a test that needed a browser
 * to read one string is a test nobody runs.
 */

function region(pixels: number, component: string, where?: string): AttributedRegion {
  return {
    region: { x: 0, y: 0, width: 10, height: 10, pixels, density: pixels / 100 },
    component,
    ...(where !== undefined ? { where } : {}),
  };
}

function observation(overrides: Partial<Observation> = {}): Observation {
  return {
    subject: 'cart/empty',
    verdict: 'changed',
    because: '1530 pixels differ',
    regions: [],
    rendered: true,
    missingFonts: [],
    ...overrides,
  };
}

const SOURCE = indexSource('src/ds/components.tsx', 'export function Toggle() {\n  return null;\n}\n');

describe('describeObservation', () => {
  it('says the subject and the verdict, with no regions to show', () => {
    expect(describeObservation(observation({ verdict: 'new', because: 'no baseline' }))).toBe(
      'cart/empty: new — no baseline',
    );
  });

  it('names the component a region landed on rather than only a count', () => {
    const message = describeObservation(observation({ regions: [region(86, 'Toggle')] }));

    // The whole difference from a pixel differ, in one assertion: a reader can
    // act on this line without opening an image.
    expect(message).toContain('86px — Toggle');
  });

  it('resolves a component to a file an editor can open, when given an index', () => {
    const message = describeObservation(observation({ regions: [region(86, 'Toggle')] }), SOURCE);

    expect(message).toMatch(/src\/ds\/components\.tsx:\d+/);
  });

  it('orders by area and says the ordering is not blame', () => {
    const message = describeObservation(
      observation({ regions: [region(86, 'Toggle'), region(511, 'Stack')] }),
    );

    // Stack outranks Toggle here, which is the measured failure mode this
    // project named: area measures displacement, so the container that merely
    // reflowed sorts above the component that was edited. The ordering is kept
    // because there is nothing better available on this path — and the caveat is
    // printed with it, because an unqualified ranking is a claim about cause.
    expect(message.indexOf('Stack')).toBeLessThan(message.indexOf('Toggle'));
    expect(message).toContain('measures displacement rather than blame');
  });

  it('carries the landmark phrase, so a region has a name and not an address', () => {
    const message = describeObservation(
      observation({ regions: [region(86, 'Toggle', 'checkbox "Mark as done"')] }),
    );

    expect(message).toContain('in checkbox "Mark as done"');
  });
});
