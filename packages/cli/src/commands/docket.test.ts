import { describe, expect, it } from 'vitest';
import type { RenderIdentity } from '@variance-authority/core/format';
import type { ObservationRecord } from '@variance-authority/report';
import { docketOf } from './docket.js';

const IDENTITY: RenderIdentity = {
  renderer: 'playwright-chromium',
  engine: 'chromium@132',
  platform: 'linux/x64',
  deviceScaleFactor: 1,
  fonts: ['Inter/400/normal/sha256-abc'],
};

function moved(subject: string, signals: NonNullable<ObservationRecord['signals']>): ObservationRecord {
  return { subject, verdict: 'unchanged', because: 'no pixels differ', changedPixels: 0, regions: [], signals };
}

describe('the moves of an avalanche', () => {
  it('lists the move that reached the most subjects first', () => {
    // An upgrade and a recipe change in one run: the reviewer reads the bigger
    // avalanche first, whichever cause the report happened to meet first.
    const recipe = { identity: 'recipe' as const, moved: ['stabilization abc → def'] };
    const engine = { identity: 'machine' as const, moved: ['engine chromium@131 → chromium@132'] };
    const docket = docketOf({
      runVersion: 1,
      at: '2026-08-01T10:00:00.000Z',
      identity: IDENTITY,
      retention: 'durable',
      observations: [moved('story:a', recipe), moved('story:b', engine), moved('story:c', engine)],
      notObserved: [],
    });

    expect(docket.moves.map((move) => [move.moved, move.unchanged])).toEqual([
      [engine.moved, 2],
      [recipe.moved, 1],
    ]);
  });
});
