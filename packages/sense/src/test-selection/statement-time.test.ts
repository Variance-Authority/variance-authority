import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import caseOwner from './case-owner.cjs';
import journals from './journal-format.cjs';

/** The collectors as a worker loads them: built, as `collectors.test.ts` says. */
const collectors = createRequire(import.meta.url)(
  '../../dist/test-selection/collectors.cjs',
) as typeof import('./collectors.cjs');

type Cut = (line: number) => void;
type Scope = { enter<Result>(key: string, body: () => Result): Result; begin(): void; leave(): void };

const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');
const FILE = 'file.test.js';

/** Holds the thread for `ms` on a clock no fake timer replaces, so a wait is never short. */
function spin(ms: number): void {
  const until = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
  while (process.hrtime.bigint() < until);
}

/** Runs each body as a case of one cut file, and reads each case's slowest statement from its frame. */
function timed(bodies: Record<string, (cut: Cut) => void>, hook?: (cut: Cut) => void) {
  const holder: Record<PropertyKey, unknown> = {};
  const collector = collectors.scoped(holder, true);
  const scope = holder[CASE_SCOPE] as Scope;
  const cut: Cut = (line) => (holder.__VA__ as { c(line: number): void }).c(line);
  for (const [name, body] of Object.entries(bodies)) {
    scope.begin();
    hook?.(cut);
    scope.enter(caseOwner.packCase(FILE, name, name), () => body(cut));
    hook?.(cut);
    scope.leave();
  }
  const frames = journals.unpackFrames(journals.packFrames(collector.finish(FILE).frames ?? []));
  const cases = frames.map((frame) => caseOwner.unpackCase(journals.decodeJournal(frame).testFile));
  return Object.fromEntries(cases.filter((unpacked) => unpacked.name !== '').map((unpacked) => [unpacked.name, unpacked.slowest]));
}

describe('how a case times its statements', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('names the line that took longest, closes the last statement at the case\'s end, and says nothing under a millisecond', () => {
    const slowest = timed({
      waits: (cut) => { cut(3); spin(5); cut(4); spin(40); cut(6); },
      ends: (cut) => { cut(3); cut(4); spin(20); },
      quick: (cut) => { cut(3); cut(4); },
      uncut: () => { spin(5); },
    });

    expect(slowest.waits?.line).toBe(4);
    expect(slowest.waits?.time).toBeGreaterThanOrEqual(40);
    expect(slowest.waits?.time).toBeLessThan(400);
    expect(Number.isInteger(slowest.waits?.time)).toBe(true);
    expect(slowest.ends?.line).toBe(4);
    expect(slowest.ends?.time).toBeGreaterThanOrEqual(20);
    // Absent, never zero: a reader cannot take "untimed" for "instant".
    expect(slowest.quick).toBeUndefined();
    expect(slowest.uncut).toBeUndefined();
  });

  it('counts a statement inside a loop as the sum of its runs', () => {
    const slowest = timed({
      loops: (cut) => {
        cut(3);
        spin(30);
        for (let turn = 0; turn < 3; turn += 1) {
          cut(5);
          spin(15);
        }
        cut(7);
      },
    });

    // No single run of line 5 outlasted line 3; the three together did.
    expect(slowest.loops?.line).toBe(5);
    expect(slowest.loops?.time).toBeGreaterThanOrEqual(45);
  });

  it('times a case on the real clock while the case fakes its timers', () => {
    const slowest = timed({
      fakes: (cut) => {
        cut(3);
        vi.useFakeTimers({ toFake: ['Date', 'performance', 'setTimeout'] });
        cut(4);
        spin(30);
        cut(5);
        vi.advanceTimersByTime(60_000);
        cut(6);
      },
    });

    expect(slowest.fakes?.line).toBe(4);
    expect(slowest.fakes?.time).toBeGreaterThanOrEqual(30);
    expect(slowest.fakes?.time).toBeLessThan(10_000);
  });

  it('times only the case\'s own statements, not the hooks around it', () => {
    const slowest = timed({ hooked: (cut) => { cut(3); spin(10); cut(4); } }, (cut) => { cut(1); spin(40); });

    expect(slowest.hooked?.line).toBe(3);
    expect(slowest.hooked?.time).toBeLessThan(40);
  });
});
