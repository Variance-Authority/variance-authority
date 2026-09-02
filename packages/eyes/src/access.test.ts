import { describe, expect, it } from 'vitest';
import { createEyesLog } from './access.js';

describe('the attention journal', () => {
  it('owns deterministic ordering and drains without resetting identity', () => {
    const log = createEyesLog();

    log.record({
      kind: 'rtl-query',
      query: 'queryByText',
      arguments: ['missing'],
      outcome: 'absent',
    });
    log.record({
      kind: 'playwright-locator',
      operation: 'planned',
      locator: [{ member: 'getByRole', arguments: ['button'] }],
    });

    expect(log.seen.map((entry) => entry.sequence)).toEqual([0, 1]);
    expect(log.drain()).toHaveLength(2);
    expect(log.seen).toEqual([]);

    expect(
      log.record({
        kind: 'rtl-query',
        query: 'queryByText',
        arguments: ['still missing'],
        outcome: 'absent',
      }).sequence,
    ).toBe(2);
  });
});
