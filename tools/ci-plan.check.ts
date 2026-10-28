import { describe, expect, it } from 'vitest';
import { suitePlan } from './ci-plan.mjs';

const full = { by: 'recorded', shards: 3, matrix: ['1/3', '2/3', '3/3'], wall: 220_000, files: 90 };
const selected = (wall: number, files = 80) => ({ by: 'recorded', shards: 1, matrix: ['1/1'], wall, files });

describe('CI chooses a suite run by recorded wall time', () => {
  it('uses the sharded full suite when a broad selection takes longer', () => {
    expect(suitePlan('chromium', full, selected(460_000))).toEqual([
      { suite: 'chromium', mode: 'whole', shard: '1/3' },
      { suite: 'chromium', mode: 'whole', shard: '2/3' },
      { suite: 'chromium', mode: 'whole', shard: '3/3' },
    ]);
  });
  it('starts only one selected job when it is cheaper, including a tie', () => {
    for (const wall of [120_000, 220_000]) {
      expect(suitePlan('unit', full, selected(wall))).toEqual([{ suite: 'unit', mode: 'selected' }]);
    }
  });
  it('keeps an empty selection in one job so its record is still handed on', () => {
    expect(suitePlan('unit', full, selected(100_000, 0))).toEqual([{ suite: 'unit', mode: 'selected' }]);
  });
  it('uses whole shards when selection costs cannot be read or no selection was asked for', () => {
    for (const selection of [undefined, { by: 'unrecorded', shards: 1 }]) {
      expect(suitePlan('unit', full, selection)).toHaveLength(3);
      expect(suitePlan('unit', full, selection).every((leg: { mode: string }) => leg.mode === 'whole')).toBe(true);
    }
  });
  it('keeps an unrecorded suite at its configured full shard count', () => {
    expect(suitePlan('unit', { by: 'unrecorded', shards: 2, matrix: ['1/2', '2/2'] }, { by: 'unrecorded', shards: 1 })).toEqual([
      { suite: 'unit', mode: 'whole', shard: '1/2' }, { suite: 'unit', mode: 'whole', shard: '2/2' },
    ]);
  });
  it('uses a slice record for a whole run of one job', () => {
    expect(suitePlan('integration', { ...full, shards: 1, matrix: ['1/1'] })).toEqual([{ suite: 'integration', mode: 'whole' }]);
  });
});
