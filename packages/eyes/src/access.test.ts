import { describe, expect, it } from 'vitest';
import { createEyesArchive, createEyesLog } from './access.js';

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
    log.phase('act');

    expect(log.seen.map((entry) => entry.sequence)).toEqual([0, 1, 2]);
    expect(log.seen[2]).toMatchObject({ kind: 'eyes-phase', phase: 'act' });
    expect(log.drain()).toHaveLength(3);
    expect(log.seen).toEqual([]);

    expect(
      log.record({
        kind: 'rtl-query',
        query: 'queryByText',
        arguments: ['still missing'],
        outcome: 'absent',
      }).sequence,
    ).toBe(3);
  });

  it('keeps complete and explicitly partial test journals distinct', () => {
    const archive = createEyesArchive([
      { id: 'a', title: 'redraws', complete: true, attention: [] },
      { id: 'b', title: 'loads', complete: false, because: 'worker exited', attention: [] },
    ]);

    expect(archive).toMatchObject({ eyesVersion: 1, tests: [{ complete: true }, { complete: false }] });
    expect(() => createEyesArchive([
      { id: 'b', title: 'loads', complete: false, because: '', attention: [] },
    ])).toThrow(/requires a reason/);
  });

  it('keeps each attempt of one test, and refuses a journal that repeats one', () => {
    const attempt = (number: number) => ({ id: 'a', attempt: number, title: 'redraws', complete: true as const, attention: [] });
    expect(createEyesArchive([attempt(1), attempt(2)]).tests.map((test) => test.attempt)).toEqual([1, 2]);
    expect(() => createEyesArchive([attempt(2), attempt(2)])).toThrow('duplicate eyes test id: a, attempt 2');
    const unnumbered = { id: 'a', title: 'redraws', complete: true as const, attention: [] };
    expect(() => createEyesArchive([unnumbered, unnumbered])).toThrow(/^duplicate eyes test id: a$/u);
  });
});
