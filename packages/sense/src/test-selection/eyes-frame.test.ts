import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';
import caseOwner from './case-owner.cjs';
import journals from './journal-format.cjs';

/** As a worker loads them: built, because they `require` their neighbours by the names the build gives them. */
const load = createRequire(import.meta.url);
const collectors = load('../../dist/test-selection/collectors.cjs') as typeof import('./collectors.cjs');
const eyesFrames = load('../../dist/test-selection/eyes-frame.cjs') as typeof import('./eyes-frame.cjs');

const CASE_SCOPE = Symbol.for('variance-authority.test-selection.cases');
const FILE = 'file.test.js';
const ROOT = '/repo';

interface Attended {
  enter<Result>(key: string, body: () => Result): Result;
  readonly root?: string;
  eyes?(journal: Readonly<Record<string, unknown>>): boolean;
  watch?(): void;
  begin?(): void;
  leave?(): void;
}

function collector(root: string | undefined, continuations = false) {
  const holder: Record<PropertyKey, unknown> = {};
  const made = collectors.scoped(holder, continuations, undefined, root);
  return { made, scope: holder[CASE_SCOPE] as Attended };
}

/** What the file's write says Eyes handed over, in the order it was handed. */
function handed(frames: readonly Uint8Array[] | undefined) {
  return journals.unpackFrames(journals.packFrames(frames ?? []))
    .map((frame) => eyesFrames.decodeEyesFrame(frame))
    .filter((frame) => frame !== undefined && frame.ended === undefined)
    .map((frame) => ({ ...frame!, case: caseOwner.unpackCase(frame!.case).name }));
}

/** What the file's write says of how attempts ended, in the order they settled. */
function ended(frames: readonly Uint8Array[] | undefined) {
  return journals.unpackFrames(journals.packFrames(frames ?? []))
    .map((frame) => eyesFrames.decodeEyesFrame(frame))
    .filter((frame) => frame?.ended !== undefined)
    .map((frame) => ({ ...frame!, case: caseOwner.unpackCase(frame!.case).name }));
}

const key = (name: string) => caseOwner.packCase(FILE, name, name);

describe('what Eyes hands a case, as the collector writes it', () => {
  it('writes a journal handed in the body or the attempt\'s hooks under the case, and counts its attempts', () => {
    const { made, scope } = collector(ROOT);
    expect(scope.root).toBe(ROOT);
    scope.begin!();
    scope.enter(key('retried'), () => expect(scope.eyes!({ step: 'body' })).toBe(true));
    // `afterEach`: the body has settled, the attempt has not.
    expect(scope.eyes!({ step: 'after' })).toBe(true);
    scope.leave!();
    scope.begin!();
    scope.enter(key('retried'), () => {});
    expect(scope.eyes!({ step: 'second' })).toBe(true);
    scope.leave!();

    expect(handed(made.finish(FILE).frames)).toEqual([
      { case: 'retried', attempt: 1, journal: { step: 'body' } },
      { case: 'retried', attempt: 1, journal: { step: 'after' } },
      { case: 'retried', attempt: 2, journal: { step: 'second' } },
    ]);
  });

  it('refuses a journal no attempt can own, and writes nothing for it', () => {
    const { made, scope } = collector(ROOT);
    expect(scope.eyes!({ step: 'outside' })).toBe(false);
    scope.begin!();
    scope.enter(key('done'), () => {});
    scope.leave!();
    expect(scope.eyes!({ step: 'after leave' })).toBe(false);

    expect(handed(made.finish(FILE).frames)).toEqual([]);
  });

  it('names a case that watched from `beforeEach` once its attempt enters it, and no watch outside an attempt', () => {
    const { made, scope } = collector(ROOT);
    scope.watch!();
    scope.begin!();
    // `beforeEach`: the attempt has not named its case yet.
    scope.watch!();
    scope.enter(key('watched early'), () => {});
    scope.leave!();
    scope.begin!();
    scope.enter(key('watched inside'), () => scope.watch!());
    scope.leave!();

    expect(handed(made.finish(FILE).frames)).toEqual([
      { case: 'watched early', attempt: 1 },
      { case: 'watched inside', attempt: 1 },
    ]);
  });

  it('keeps no journal once two cases ran at once, since the file writes no case frame', () => {
    const { made, scope } = collector(ROOT);
    scope.begin!();
    const warn = console.warn;
    console.warn = () => {};
    try {
      scope.enter(key('outer'), () => scope.enter(key('inner'), () => {
        expect(scope.eyes!({ step: 'tangled' })).toBe(false);
        scope.watch!();
      }));
    } finally {
      console.warn = warn;
    }
    scope.leave!();

    expect(made.finish(FILE).frames).toBeUndefined();
  });

  it('hands Eyes nothing when the collector was given no checkout', () => {
    const { scope } = collector(undefined);
    expect(scope.eyes).toBeUndefined();
    expect(scope.watch).toBeUndefined();
  });
});

describe('how an attempt ended, as the collector writes it', () => {
  it('writes each attempt of a case entered twice, with what a failed one threw, and nothing for a case entered once', async () => {
    const { made, scope } = collector(undefined);
    scope.enter(key('once'), () => {});
    expect(() => scope.enter(key('failed once'), () => { throw new Error('gave up'); })).toThrow('gave up');
    expect(() => scope.enter(key('retried'), () => { throw new Error('first try'); })).toThrow('first try');
    let pass!: () => void;
    const second = scope.enter(key('retried'), () => new Promise<void>((resolve) => { pass = resolve; }));
    pass();
    await second;

    expect(ended(made.finish(FILE).frames)).toEqual([
      { case: 'retried', attempt: 1, ended: 'failed', duration: expect.any(Number), message: 'first try', stack: expect.stringContaining('eyes-frame.test.ts') },
      { case: 'retried', attempt: 2, ended: 'passed', duration: expect.any(Number) },
    ]);
  });

  it('names the attempt a body was entered as, when it settles after the next one was entered', async () => {
    const { made, scope } = collector(undefined, true);
    let fail!: (thrown: unknown) => void;
    const first = scope.enter(key('late'), () => new Promise<void>((_, reject) => { fail = reject; }));
    scope.enter(key('late'), () => {});
    fail('a thrown string');
    await expect(first).rejects.toBe('a thrown string');

    expect(ended(made.finish(FILE).frames)).toEqual([
      { case: 'late', attempt: 2, ended: 'passed', duration: expect.any(Number) },
      { case: 'late', attempt: 1, ended: 'failed', duration: expect.any(Number), message: 'a thrown string' },
    ]);
  });
});

describe('an eyes frame', () => {
  it('is not one when it is a case frame or shorter than its magic', () => {
    expect(eyesFrames.decodeEyesFrame(journals.encodeJournal(key('a'), new Map()))).toBeUndefined();
    expect(eyesFrames.decodeEyesFrame(new Uint8Array([0x56, 0x41]))).toBeUndefined();
  });

  it('refuses a frame behind its magic that does not name a case and an attempt', () => {
    const magic = eyesFrames.encodeEyesFrame({ case: 'c', attempt: 1 }).subarray(0, 8);
    const framed = (body: string) => new Uint8Array([...magic, ...Buffer.from(body, 'utf8')]);
    for (const body of ['null', '{"attempt":1}', '{"case":"c"}', '{"case":"c","attempt":1,"journal":null}', '{"case":"c","attempt":1,"journal":"x"}']) {
      expect(() => eyesFrames.decodeEyesFrame(framed(body)), body).toThrow('not a variance-authority eyes frame');
    }
  });
});
