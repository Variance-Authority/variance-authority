import { describe, expect, it } from 'vitest';
import { environmentKey } from './environment.js';
import { CHROMIUM_PROFILE } from './profile.js';
import { isSemanticSnapshot } from './shape.js';
import type { SemanticNode, SemanticSnapshot } from './snapshot.js';

/**
 * Whether a value read back is a snapshot, field by field.
 *
 * A snapshot comes back from a capture file and from a packed baseline, and
 * whatever this lets through is walked by readers that trust the type: the
 * matcher, and the parting that compares what each component held.
 */

const ENVIRONMENT = {
  profile: 'chromium',
  engine: 'chromium',
  ruleset: 'r',
  allowlist: 'a',
  viewport: { width: 8, height: 8, deviceScaleFactor: 1, colorScheme: 'light' },
  fonts: [],
  conditions: {},
  assets: {},
} as const;

function snapshotWith(child: Partial<SemanticNode> | Record<string, unknown>, inputs: object = ENVIRONMENT): SemanticSnapshot {
  return {
    formatVersion: 1,
    subject: { id: 's', kind: 'fixture' },
    profile: CHROMIUM_PROFILE,
    environment: environmentKey(inputs as typeof ENVIRONMENT),
    renderHash: 'v1:r',
    structureHash: 'v1:s',
    styleHash: 'v1:t',
    root: {
      path: '0',
      tag: 'div',
      attributes: {},
      style: {},
      children: [{ path: '0/0', tag: 'span', attributes: {}, style: {}, children: [], ...child } as SemanticNode],
    },
    styleProvenance: [],
    diagnostics: [],
  };
}

describe('a snapshot read back', () => {
  it('is one when every node and every field is what its type declares', () => {
    const held = {
      holding: {
        cells: [{ index: 0, hook: 'useState', digest: 'v1:c' }],
        contexts: [{ name: 'Theme', digest: 'v1:t' }],
        props: [{ name: 'label', digest: 'v1:p' }],
      },
    };
    expect(isSemanticSnapshot(snapshotWith(held, { ...ENVIRONMENT, timezoneId: 'Europe/Berlin', locale: 'de-DE' }))).toBe(true);
  });

  it('is not one when a node below its root is not a node', () => {
    expect(isSemanticSnapshot(snapshotWith({ children: undefined }))).toBe(false);
  });

  it('is not one when what a node held is not a holding', () => {
    // `compareHoldings` reads every cell's index and digest, and would throw on
    // one that is not there rather than read the snapshot as not recorded.
    expect(isSemanticSnapshot(snapshotWith({ holding: { cells: [{ hook: 'useState' }] } }))).toBe(false);
  });

  it('is not one when its environment names a region that is not text', () => {
    expect(isSemanticSnapshot(snapshotWith({}, { ...ENVIRONMENT, locale: 7 }))).toBe(false);
  });

  it('is not one when its profile is one this code does not know', () => {
    expect(isSemanticSnapshot({ ...snapshotWith({}), profile: { ...CHROMIUM_PROFILE, id: 'webkit' } })).toBe(false);
  });
});
