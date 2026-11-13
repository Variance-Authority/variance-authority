import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import caseOwner from './case-owner.cjs';
import { slowestAcross } from './execution-set-columns.js';
import journals from './journal-format.cjs';

/** The collectors as a worker loads them: built, as `collectors.test.ts` says. */
const collectors = createRequire(import.meta.url)(
  '../../dist/test-selection/collectors.cjs',
) as typeof import('./collectors.cjs');
/** The engine as that worker loads it, which is how a test reaches the realm's own. */
const probeLog = createRequire(import.meta.url)(
  '../../dist/instrument/probe-log.cjs',
) as typeof import('../instrument/probe-log.cjs');

type Cut = (line: number) => void;
type Scope = { enter<Result>(key: string, body: () => Result): Result; begin(): void; leave(): void };

const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');
const FILE = 'file.test.js';

/** Holds the thread for `ms` on a clock no fake timer replaces, so a wait is never short. */
function spin(ms: number): void {
  const until = process.hrtime.bigint() + BigInt(ms) * 1_000_000n;
  while (process.hrtime.bigint() < until);
}

/** One cut file's recording: its case scope, its cut, and each case's slowest statement once the file ends. */
function recording() {
  const holder: Record<PropertyKey, unknown> = {};
  const collector = collectors.scoped(holder, true);
  const scope = holder[CASE_SCOPE] as Scope;
  const cut: Cut = (line) => (holder.__VA__ as { c(line: number): void }).c(line);
  const read = () => {
    const frames = journals.unpackFrames(journals.packFrames(collector.finish(FILE).frames ?? []));
    const cases = frames.map((frame) => caseOwner.unpackCase(journals.decodeJournal(frame).testFile));
    return Object.fromEntries(cases.filter((unpacked) => unpacked.name !== '').map((unpacked) => [unpacked.name, unpacked.slowest]));
  };
  const engine = probeLog.engineOf(holder.__VA__)!;
  return { scope, cut, read, engine, key: (name: string) => caseOwner.packCase(FILE, name, name) };
}

/** Runs each body as a case of one cut file, and reads each case's slowest statement from its frame. */
function timed(bodies: Record<string, (cut: Cut) => void>, hook?: (cut: Cut) => void) {
  const { scope, cut, read, key } = recording();
  for (const [name, body] of Object.entries(bodies)) {
    scope.begin();
    hook?.(cut);
    scope.enter(key(name), () => body(cut));
    hook?.(cut);
    scope.leave();
  }
  return read();
}

/** One attempt of a case that waits on line 5 for ever, which the runner gives up on after `ms`. */
function stoppedAttempt({ scope, cut, key }: ReturnType<typeof recording>, ms: number): void {
  scope.begin();
  void scope.enter(key('hangs'), async () => { cut(4); cut(5); await new Promise(() => {}); });
  spin(ms);
  scope.leave();
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

  it('closes the statement a stopped case was in as its attempt ends, not as its file does', () => {
    const file = recording();
    stoppedAttempt(file, 20);
    file.scope.begin();
    file.scope.enter(file.key('slow'), () => { file.cut(3); spin(150); });
    file.scope.leave();
    const slowest = file.read();

    expect(slowest.hangs?.line).toBe(5);
    expect(slowest.hangs?.time).toBeGreaterThanOrEqual(20);
    expect(slowest.hangs?.time).toBeLessThan(150);
    expect(slowest.slow?.time).toBeGreaterThanOrEqual(150);
  });

  it('adds a retry to the attempt before it, once each', () => {
    const file = recording();
    stoppedAttempt(file, 20);
    spin(100);
    stoppedAttempt(file, 20);
    spin(100);
    const slowest = file.read();

    expect(slowest.hangs?.line).toBe(5);
    expect(slowest.hangs?.time).toBeGreaterThanOrEqual(40);
    expect(slowest.hangs?.time).toBeLessThan(100);
  });

  it('keeps the time of a case whose bucket is read out and emptied mid-case', () => {
    const file = recording();
    file.scope.begin();
    file.scope.enter(file.key('read'), () => {
      file.cut(3);
      spin(20);
      file.engine.take(file.engine.current());
      file.cut(4);
      spin(5);
    });
    file.scope.leave();

    const { read } = file.read();
    expect(read?.line).toBe(3);
    expect(read?.time).toBeGreaterThanOrEqual(20);
  });

  it('leaves a case running beside another its whole time when the other attempt ends', async () => {
    const file = recording();
    file.scope.begin();
    const quick = file.scope.enter(file.key('quick'), async () => { file.cut(2); await Promise.resolve(); });
    file.scope.begin();
    let release = (): void => {};
    const held = new Promise<void>((done) => { release = done; });
    const long = file.scope.enter(file.key('long'), async () => { file.cut(7); await held; });
    await quick;
    file.scope.leave();
    spin(60);
    release();
    await long;
    file.scope.leave();

    const slowest = file.read();
    expect(slowest.long?.line).toBe(7);
    expect(slowest.long?.time).toBeGreaterThanOrEqual(60);
  });
});

describe('the slowest statement of a case that ran twice', () => {
  const quick = { line: 4, time: 30 };
  const long = { line: 9, time: 80 };

  it('is the longer of the two, whichever comes first', () => {
    expect(slowestAcross(quick, long)).toEqual({ slowest: long });
    expect(slowestAcross(long, quick)).toEqual({ slowest: long });
  });

  it('is the lower line where both took as long', () => {
    const level = { line: 2, time: 80 };

    expect(slowestAcross(long, level)).toEqual({ slowest: level });
    expect(slowestAcross(level, long)).toEqual({ slowest: level });
  });

  it('is the one there is, and absent where neither run timed one', () => {
    expect(slowestAcross(quick, undefined)).toEqual({ slowest: quick });
    expect(slowestAcross(undefined, quick)).toEqual({ slowest: quick });
    expect(slowestAcross(undefined, undefined)).toEqual({});
  });
});
