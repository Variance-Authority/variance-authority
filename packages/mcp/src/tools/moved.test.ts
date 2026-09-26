import { describe, expect, it } from 'vitest';
import type { RunReport } from '@variance-authority/report';
import { toolByName } from '../tools.js';

/**
 * What each component's hashes say changed, printed where an agent reads it.
 *
 * The regions say where pixels differ, and a reflow merges an edit and
 * everything it pushed into one region whose box fits no component. The
 * hashes never looked at a pixel, so they still hold the component, the band,
 * how much its box grew and which declaration moved — and a record that holds
 * the sentence and does not print it leaves the agent to diff a file by eye.
 */

function report(observation: Record<string, unknown>): RunReport {
  return {
    runVersion: 1,
    at: '2026-09-26T10:00:00.000Z',
    identity: {
      renderer: 'playwright-chromium',
      engine: 'chromium@131.0.0',
      platform: 'darwin/arm64',
      deviceScaleFactor: 1,
      fonts: [],
    },
    retention: 'durable',
    observations: [observation],
  } as unknown as RunReport;
}

const CHANGED = {
  subject: 'story:case-surface--button-secondary',
  verdict: 'changed',
  because: '1 region differs',
  changedPixels: 1_204,
  regions: [
    { cause: true, pixels: 1_204, x: 0, y: 0, width: 112, height: 42, component: 'Button', file: 'src/ds.jsx:53' },
  ],
};

function described(observation: Record<string, unknown>): string {
  return toolByName('variance_describe')!.run(report(observation), {
    subject: 'story:case-surface--button-secondary',
  });
}

describe('the components a subject moved', () => {
  it('names the declaration that changed, with both values', () => {
    const text = described({
      ...CHANGED,
      moved: [
        {
          component: 'Button',
          bands: ['geometry', 'token'],
          cause: true,
          grew: { width: 12, height: 6 },
          changed: [
            { property: 'padding-left', from: ['8px'], to: ['14px'] },
            { property: 'box-shadow', from: [], to: ['none'] },
          ],
        },
        { component: 'Card', bands: ['geometry'], cause: false },
      ],
    });

    expect(text).toContain('cause      Button — geometry, token; box +12 × +6 px');
    expect(text).toContain('      padding-left 8px → 14px');
    expect(text).toContain('      box-shadow (not declared) → none');
    expect(text).toContain('collateral Card — geometry');
    // Before the regions: the hashes name what the pixels could not.
    expect(text.indexOf('components:')).toBeLessThan(text.indexOf('1204px'));
  });

  it('names a component that appeared by its presence', () => {
    const text = described({
      ...CHANGED,
      moved: [{ component: 'Badge', bands: ['geometry'], cause: true, presence: 'added' }],
    });

    expect(text).toContain('cause      Badge — added');
  });

  it('prints nothing when the baseline carried no hashes', () => {
    expect(described(CHANGED)).not.toContain('components:');
  });
});
