// The claim under test is that a wait is answered by the past as readily as by
// the future, and that when it is answered by neither the failure names the
// difference between "nothing was installed" and "you asked for the wrong thing".

import { describe, expect, it, vi } from 'vitest';
import { createEventLog } from './log.js';

const decided = { phase: 'once', location: 'checkout', subject: 'upsell', action: 'decided' } as const;

describe('createEventLog', () => {
  it('settles a wait against an announcement it already heard', async () => {
    const log = createEventLog();
    log.record('page', decided);
    // Written one line too late on purpose: this is the ordering a test author
    // gets wrong, and it has to be the ordering that works.
    await expect(log.happened('checkout', 'upsell', 'decided')).resolves.toMatchObject({
      realm: 'page',
      ordinal: 0,
    });
  });

  it('settles a wait against an announcement that has not happened yet', async () => {
    const log = createEventLog();
    const waiting = log.happened('checkout', 'upsell', 'decided');
    log.record('page', decided);
    await expect(waiting).resolves.toMatchObject({ action: 'decided' });
  });

  it('records the coordinates and nothing a realm carried alongside them', () => {
    const log = createEventLog();
    log.record('api', { ...decided, version: 1, head: 'api', journey: 'a-journey' } as never);
    expect(log.seen[0]).toEqual({
      phase: 'once',
      location: 'checkout',
      subject: 'upsell',
      action: 'decided',
      realm: 'api',
      ordinal: 0,
    });
  });

  it('answers whether coordinates were announced, without waiting', () => {
    const log = createEventLog();
    expect(log.saw('checkout', 'upsell', 'decided')).toBe(false);
    log.record('page', decided);
    expect(log.saw('checkout', 'upsell', 'decided')).toBe(true);
    expect(log.saw('checkout', 'upsell', 'shown')).toBe(false);
  });

  it('numbers what it heard in arrival order, across realms', () => {
    const log = createEventLog();
    log.record('page', decided);
    log.record('api', { ...decided, action: 'priced' });
    expect(log.seen.map((event) => [event.ordinal, event.realm, event.action])).toEqual([
      [0, 'page', 'decided'],
      [1, 'api', 'priced'],
    ]);
  });

  it('holds a wait for an end open while only the start has arrived', async () => {
    const log = createEventLog();
    log.record('api', { ...decided, phase: 'start', action: 'authorizing' });
    const waiting = log.finished('checkout', 'upsell', 'authorizing', { timeoutMs: 50 });
    expect(log.pending.map((event) => event.action)).toEqual(['authorizing']);
    log.record('api', { ...decided, phase: 'end', action: 'authorizing' });
    await expect(waiting).resolves.toMatchObject({ phase: 'end' });
    expect(log.pending).toEqual([]);
  });

  it('reports a process that started twice and ended once as finished', () => {
    // A retried request announces its start again. The coordinates are the
    // identity, so the second start replaces the first rather than queueing
    // behind it, and one end closes what is open.
    const log = createEventLog();
    log.record('api', { ...decided, phase: 'start', action: 'authorizing' });
    log.record('api', { ...decided, phase: 'start', action: 'authorizing' });
    log.record('api', { ...decided, phase: 'end', action: 'authorizing' });
    expect(log.pending).toEqual([]);
  });

  it('names what it did hear when a wait times out', async () => {
    const log = createEventLog();
    log.record('page', { ...decided, action: 'decidd' });
    await expect(
      log.happened('checkout', 'upsell', 'decided', { timeoutMs: 10 }),
    ).rejects.toThrow(/`checkout \/ upsell \/ decided` was never announced within 10ms/);
    await expect(
      log.happened('checkout', 'upsell', 'decided', { timeoutMs: 10 }),
    ).rejects.toThrow(/page {2}checkout \/ upsell \/ decidd/);
  });

  it('calls a run that heard nothing at all a setup problem', async () => {
    const log = createEventLog();
    await expect(
      log.happened('checkout', 'upsell', 'decided', { timeoutMs: 10 }),
    ).rejects.toThrow(/no listener is installed/);
  });

  it('summarizes the tail of a long log rather than printing it', async () => {
    const log = createEventLog();
    for (let index = 0; index < 26; index += 1) {
      log.record('page', { ...decided, action: `step-${index}` });
    }
    await expect(
      log.happened('checkout', 'upsell', 'decided', { timeoutMs: 10 }),
    ).rejects.toThrow(/… and 6 more/);
  });

  it('fails outstanding waits when the run ends', async () => {
    const log = createEventLog();
    const waiting = log.happened('checkout', 'upsell', 'decided');
    log.close('the page was closed');
    await expect(waiting).rejects.toThrow(
      /`checkout \/ upsell \/ decided` will not be announced: the page was closed/,
    );
  });

  it('fails a wait started after the run ended, rather than hanging', async () => {
    const log = createEventLog();
    log.close();
    await expect(log.happened('checkout', 'upsell', 'decided')).rejects.toThrow(
      /will not be announced: the run ended/,
    );
  });

  it('carries what a listener knows into every failure', async () => {
    const log = createEventLog();
    log.remark('api', '`api` announced twice without a journey.');
    log.remark('api', '`api` announced 3 times without a journey.');
    const timedOut = await log
      .happened('checkout', 'upsell', 'decided', { timeoutMs: 10 })
      .catch((error: Error) => error.message);
    expect(timedOut).toContain('`api` announced 3 times without a journey.');
    expect(timedOut.split('`api` announced').length - 1).toBe(1);
    log.close();
    await expect(log.happened('checkout', 'upsell', 'decided')).rejects.toThrow(
      /announced 3 times without a journey/,
    );
  });

  it('leaves no timer behind when a wait settles', async () => {
    // A settled wait whose timeout still runs keeps a process alive past the run
    // and rejects into nothing, which is how a suite acquires an unhandled
    // rejection nobody can place.
    const log = createEventLog();
    const cleared = vi.spyOn(globalThis, 'clearTimeout');
    const waiting = log.happened('checkout', 'upsell', 'decided');
    log.record('page', decided);
    await waiting;
    expect(cleared).toHaveBeenCalled();
    cleared.mockRestore();
  });

  describe('a second reader', () => {
    it('is told each announcement as it is recorded, in the same order', () => {
      const told: string[] = [];
      const log = createEventLog({ onRecord: (event) => told.push(event.action) });

      log.record('page', { phase: 'once', location: 'checkout', subject: 'upsell', action: 'shown' });
      log.record('api', { phase: 'once', location: 'checkout', subject: 'upsell', action: 'decided' });

      expect(told).toEqual(['shown', 'decided']);
    });

    it('is told each remark', () => {
      const told: string[] = [];
      const log = createEventLog({ onRemark: (about, sentence) => told.push(`${about}: ${sentence}`) });

      log.remark('api', 'answered twice for nobody');

      expect(told).toEqual(['api: answered twice for nobody']);
    });

    it('cannot break the run by failing', async () => {
      // A watcher is an observer, and an observer whose failure reaches the
      // subject is worse than no watcher at all.
      const log = createEventLog({
        onRecord: () => {
          throw new Error('the watcher went away');
        },
      });

      expect(() =>
        log.record('page', { phase: 'once', location: 'checkout', subject: 'upsell', action: 'decided' }),
      ).not.toThrow();
      await expect(log.happened('checkout', 'upsell', 'decided')).resolves.toMatchObject({
        action: 'decided',
      });
    });
  });
});
