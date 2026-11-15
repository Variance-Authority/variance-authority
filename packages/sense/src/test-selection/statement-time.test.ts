import { createRequire } from 'node:module';
import { afterEach, describe, expect, it, vi } from 'vitest';
import caseOwner from './case-owner.cjs';
import { timesAcross } from './case-times.js';
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

/** One cut file's recording: its case scope, its cut, and each case's statement times once the file ends. */
function recording() {
  const holder: Record<PropertyKey, unknown> = {};
  const collector = collectors.scoped(holder, true);
  const scope = holder[CASE_SCOPE] as Scope;
  const cut: Cut = (line) => (holder.__VA__ as { c(line: number): void }).c(line);
  const read = () => {
    const frames = journals.unpackFrames(journals.packFrames(collector.finish(FILE).frames ?? []));
    const cases = frames.map((frame) => caseOwner.unpackCase(journals.decodeJournal(frame).testFile));
    return Object.fromEntries(cases.filter((unpacked) => unpacked.name !== '').map((unpacked) => [unpacked.name, unpacked.times]));
  };
  const engine = probeLog.engineOf(holder.__VA__)!;
  return { scope, cut, read, engine, key: (name: string) => caseOwner.packCase(FILE, name, name) };
}

/** Runs each body as a case of one cut file, and reads each case's statement times from its frame. */
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

type Times = ReturnType<ReturnType<typeof recording>['read']>[string];

/** The lines a case's times name, in the order it first reached them. */
const linesOf = (times: Times) => times?.map(({ line }) => line);
/** The microseconds `line` held, or undefined where the case did not time it. */
const at = (times: Times, line: number) => times?.find((statement) => statement.line === line)?.time;
/** A millisecond in the unit times are kept in. */
const MS = 1000;

describe('how a case times its statements', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('times every line its body cut at, in the order it reached them, a statement under a millisecond included', () => {
    const times = timed({
      waits: (cut) => { cut(3); spin(5); cut(4); spin(40); cut(6); },
      ends: (cut) => { cut(3); cut(4); spin(20); },
      quick: (cut) => { cut(9); cut(3); },
      uncut: () => { spin(5); },
    });

    expect(linesOf(times.waits)).toEqual([3, 4, 6]);
    expect(at(times.waits, 3)).toBeGreaterThanOrEqual(5 * MS);
    expect(at(times.waits, 4)).toBeGreaterThanOrEqual(40 * MS);
    expect(at(times.waits, 4)).toBeLessThan(400 * MS);
    // The last statement closes at the case's end, however short it was.
    expect(at(times.waits, 6)).toBeLessThan(at(times.waits, 4)!);
    expect(at(times.ends, 4)).toBeGreaterThanOrEqual(20 * MS);
    // No threshold: a statement of a few microseconds keeps them.
    expect(linesOf(times.quick)).toEqual([9, 3]);
    expect(at(times.quick, 3)).toBeLessThan(at(times.waits, 4)!);
    for (const { time } of [...times.waits!, ...times.quick!]) expect(Number.isInteger(time)).toBe(true);
    // Absent, never zero: a reader cannot take "untimed" for "instant".
    expect(times.uncut).toBeUndefined();
  });

  it('counts a statement inside a loop as the sum of its runs', () => {
    const times = timed({
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

    expect(linesOf(times.loops)).toEqual([3, 5, 7]);
    expect(at(times.loops, 5)).toBeGreaterThanOrEqual(45 * MS);
  });

  it('times a case on the real clock while the case fakes its timers', () => {
    const times = timed({
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

    expect(at(times.fakes, 4)).toBeGreaterThanOrEqual(30 * MS);
    expect(at(times.fakes, 5)).toBeLessThan(10_000 * MS);
  });

  it('times only the case\'s own statements, not the hooks around it', () => {
    const times = timed({ hooked: (cut) => { cut(3); spin(10); cut(4); } }, (cut) => { cut(1); spin(100); });

    expect(linesOf(times.hooked)).toEqual([3, 4]);
    expect(at(times.hooked, 3)! + at(times.hooked, 4)!).toBeLessThan(100 * MS);
  });

  it('closes the statement a stopped case was in as its attempt ends, not as its file does', () => {
    const file = recording();
    stoppedAttempt(file, 20);
    file.scope.begin();
    file.scope.enter(file.key('slow'), () => { file.cut(3); spin(150); });
    file.scope.leave();
    const times = file.read();

    expect(linesOf(times.hangs)).toEqual([4, 5]);
    expect(at(times.hangs, 5)).toBeGreaterThanOrEqual(20 * MS);
    expect(at(times.hangs, 5)).toBeLessThan(at(times.slow, 3)!);
    expect(at(times.slow, 3)).toBeGreaterThanOrEqual(150 * MS);
  });

  it('adds a retry to the attempt before it, once each', () => {
    const file = recording();
    stoppedAttempt(file, 20);
    spin(100);
    stoppedAttempt(file, 20);
    spin(100);
    const times = file.read();

    expect(linesOf(times.hangs)).toEqual([4, 5]);
    expect(at(times.hangs, 5)).toBeGreaterThanOrEqual(40 * MS);
    expect(at(times.hangs, 5)).toBeLessThan(100 * MS);
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
    expect(linesOf(read)).toEqual([3, 4]);
    expect(at(read, 3)).toBeGreaterThanOrEqual(20 * MS);
    expect(at(read, 4)).toBeGreaterThanOrEqual(5 * MS);
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

    const times = file.read();
    expect(at(times.long, 7)).toBeGreaterThanOrEqual(60 * MS);
  });

  /** A case that waits on line 7 until `release`, entered in an attempt of its own. */
  function waiting(file: ReturnType<typeof recording>) {
    let release = (): void => {};
    const held = new Promise<void>((done) => { release = done; });
    file.scope.begin();
    const body = file.scope.enter(file.key('waits'), async () => { file.cut(7); await held; });
    return { body, release };
  }

  it('keeps the whole time of a case that outlasts two beside it that settle together', async () => {
    const file = recording();
    const { body, release } = waiting(file);
    file.scope.begin();
    const first = file.scope.enter(file.key('first'), async () => { await Promise.resolve(); });
    file.scope.begin();
    const second = file.scope.enter(file.key('second'), async () => { await Promise.resolve(); });
    await Promise.all([first, second]);
    file.scope.leave();
    file.scope.leave();
    spin(60);
    release();
    await body;
    file.scope.leave();

    const { waits } = file.read();
    expect(at(waits, 7)).toBeGreaterThanOrEqual(60 * MS);
  });

  it('keeps the whole time of a case beside an attempt that ends without a body', async () => {
    const file = recording();
    const { body, release } = waiting(file);
    file.scope.begin();
    file.scope.leave();
    spin(60);
    release();
    await body;
    file.scope.leave();

    const { waits } = file.read();
    expect(at(waits, 7)).toBeGreaterThanOrEqual(60 * MS);
  });
});

describe('the times of a case that ran twice', () => {
  const quick = [{ line: 4, time: 30 }, { line: 9, time: 10 }];
  const long = [{ line: 9, time: 80 }];

  it('are the run that took longer in all, whichever comes first', () => {
    expect(timesAcross(quick, long)).toEqual({ times: long });
    expect(timesAcross(long, quick)).toEqual({ times: long });
  });

  it('are the lower run, line by line, where both took as long', () => {
    const level = [{ line: 2, time: 80 }];

    expect(timesAcross(long, level)).toEqual({ times: level });
    expect(timesAcross(level, long)).toEqual({ times: level });
  });

  it('are the run there is, and absent where neither run was timed', () => {
    expect(timesAcross(quick, undefined)).toEqual({ times: quick });
    expect(timesAcross(undefined, quick)).toEqual({ times: quick });
    expect(timesAcross(undefined, undefined)).toEqual({});
  });
});
