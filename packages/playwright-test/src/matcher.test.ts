import { describe, expect, it } from 'vitest';
import { indexSource } from '@variance-authority/core/attribute';
import type { AttributedRegion } from '@variance-authority/core/attribute';
import type { Observation } from '@variance-authority/observe';
import { assertUnchanged, toBeUnchanged, varianceMatchers } from './matcher.js';

/**
 * The matcher and the assertion, held to being one reading rather than two.
 *
 * The README calls `toBeUnchanged` "the same verdict read as a matcher rather
 * than an assertion". Two entrypoints onto one verdict is exactly the shape that
 * drifts quietly — a suite using the matcher and a suite using the assertion
 * would disagree about the same observation and neither would say so.
 */

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

const REGION: AttributedRegion = {
  region: { x: 0, y: 0, width: 10, height: 10, pixels: 86, density: 0.86 },
  component: 'Toggle',
};

const SOURCE = indexSource('src/ds/components.tsx', 'export function Toggle() {\n  return null;\n}\n');

describe('toBeUnchanged', () => {
  it('passes on exactly the one verdict that means nothing moved', () => {
    const verdicts = ['unchanged', 'changed', 'new', 'ignored', 'incomparable', 'unstable', 'failed'] as const;

    const passing = verdicts.filter((verdict) => toBeUnchanged(observation({ verdict })).pass);

    // `ignored` and `unstable` are the ones worth stating: neither is a
    // difference anybody has to look at, and neither is a claim that the subject
    // is the same as its baseline.
    expect(passing).toEqual(['unchanged']);
  });

  it('prints the same failure the assertion throws', () => {
    const subject = observation({ regions: [REGION] });

    const thrown = (() => {
      try {
        assertUnchanged(subject, { source: SOURCE });
        return undefined;
      } catch (error) {
        return (error as Error).message;
      }
    })();

    expect(toBeUnchanged(subject, { source: SOURCE }).message()).toBe(thrown);
    expect(thrown).toContain('86px — Toggle');
  });

  it('says why it passed, so a passing run still reads as a comparison', () => {
    const message = toBeUnchanged(observation({ verdict: 'unchanged', because: '0 pixels differ' })).message();

    expect(message).toBe('cart/empty: 0 pixels differ');
  });

  it('is the only matcher in the extension object, under the name expect will call', () => {
    // `expect.extend` keys by property name. A rename here silently removes
    // `toBeUnchanged` from every suite that spread this object.
    expect(Object.keys(varianceMatchers)).toEqual(['toBeUnchanged']);
    expect(varianceMatchers.toBeUnchanged).toBe(toBeUnchanged);
  });
});
