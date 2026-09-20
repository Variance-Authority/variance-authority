import { describe, expect, it } from 'vitest';
import { instrument } from './index.js';

/**
 * What the probe is allowed to contain.
 *
 * The emitted `__va` is the most-executed function this project ships — once
 * per region per entry, hundreds of millions of times in a suite — so what it
 * costs is decided by what is written in it rather than by anything downstream.
 * A guard added here is paid on every hit forever, and the kind that gets added
 * is the kind that reads well in review: a `typeof`, a truthiness test, a
 * defensive branch around a state that is fatal anyway.
 *
 * So the absence is pinned rather than trusted. `packages/sense/scripts/probe-write.mjs`
 * prices the alternatives; this refuses the ones that were removed. That a
 * module with no collector still stops the run is next door, in
 * `instrument.test.ts`, where a realm can be built without one.
 */
describe('the emitted probe', () => {
  const code = (): string =>
    instrument('function f(n) { if (n) { return 1; } return 2; }', 'fixture.js')!.code;

  it('resolves the factory and asks the scope, and tests neither', () => {
    expect(code()).toContain('const g=globalThis.__VA__;const r=g.s?g.s():g;');
  });

  it('carries no type check and no message', () => {
    expect(code()).not.toContain('typeof r');
    expect(code()).not.toContain('throw new Error');
    expect(code()).not.toMatch(/instrumented for test selection/);
  });

  it('registers on factory identity alone', () => {
    // `__va.r` starts undefined and no factory is undefined, so the identity
    // test answers the first call too. A second condition beside it would be a
    // load and a compare on every hit after that one.
    expect(code()).toContain('if(__va.r!==r){');
    expect(code()).not.toContain('__va.c===undefined||');
  });

  it('writes the counter once, with the evaluating bit', () => {
    expect(code()).toContain('__va.c[i]=__va.c[i]+1|(r.e>0?2147483648:0)}');
  });
});
