import { describe, expect, it } from 'vitest';
import { instrument } from './index.js';

/**
 * What the probe is allowed to contain.
 *
 * The emitted `__va` is the most-executed function this project ships — once
 * per region per entry, hundreds of millions of times in a suite — so what it
 * costs is decided by what is written in it rather than by anything downstream.
 * Almost every hit is a region already logged, and that hit is the gate alone:
 * 1.2 ns at 4 and 16 regions and 3.2 ns at 64 under `probe-write.mjs`. A guard
 * added here is paid on every hit forever, and the kind that gets added is the
 * kind that reads well in review: a `typeof`, a truthiness test, a defensive
 * branch around a state that is fatal anyway.
 *
 * So the absence is pinned rather than trusted. `packages/sense/scripts/probe-write.mjs`
 * prices the alternatives; this refuses the ones that were removed. That a
 * module with no collector still stops the run is next door, in
 * `instrument.test.ts`, where a realm can be built without one.
 */
describe('the emitted probe', () => {
  const code = (): string =>
    instrument('function f(n) { if (n) { return 1; } return 2; }', 'fixture.js')!.code;

  it('answers a hit it has already logged with two byte reads and no call', () => {
    // The flag byte holds which side of evaluation logged it, and the passing
    // byte which side is running now; their `and` is zero only when the region
    // has something left to log. A circular import can reach the probe before
    // the header runs, so the two names start as functions, whose bytes read
    // as `undefined`, and the `and` of those is zero too.
    expect(code()).toContain('function __va(i){if((__vaF[i]&__vaP[0])===0)__vaS(i)}');
    expect(code()).toContain('function __vaF(){}function __vaP(){}');
  });

  it('reads the root once per module, and asks the scope only where there is one', () => {
    // Under Jest the global is an interceptor call on a contextified object;
    // this is a module-scoped variable, read once.
    expect(code()).toContain('function __vaS(i){const K=__vaK||__vaI();if(K.s!==null)K.s();const a=K.a;if(__vaA!==a){');
    expect(code()).toContain('function __vaE(){(__vaK||__vaI()).x()}');
  });

  it('carries no type check and no message', () => {
    expect(code()).not.toContain('typeof ');
    expect(code()).not.toContain('throw new Error');
    expect(code()).not.toMatch(/instrumented for test selection/);
  });

  it('logs a region on its first touch in a segment and only reads its flag after that', () => {
    expect(code()).toContain('const f=__vaG[i],p=__vaP[0];if((f&p)===0){__vaG[i]=f|p;');
    expect(code()).not.toContain('+1|');
  });

  it('appends to the log inline, and hands a full log to the root', () => {
    expect(code()).toContain('const n=K.n;if(n<K.l){K.L[n]=(__vaB+i)|K.v;K.n=n+1}else K.g((__vaB+i)|K.v)}}');
  });
});
