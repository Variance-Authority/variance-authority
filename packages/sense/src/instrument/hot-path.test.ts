import { describe, expect, it } from 'vitest';
import { instrument } from './index.js';
import probeSet from './probe-set.cjs';

/**
 * What the probe is allowed to contain.
 *
 * The probe is the most-executed function this project ships — once per region
 * per entry, hundreds of millions of times in a suite — so what it costs is
 * decided by what is written in it rather than by anything downstream. Almost
 * every hit is a region already logged, and that hit is the gate alone: 0.6 ns
 * at 4 regions, 1.0 ns at 16 and 3.3 ns at 64 under `probe-write.mjs`. A guard added
 * here is paid on every hit forever, and the kind that gets added is the kind
 * that reads well in review: a `typeof`, a truthiness test, a defensive branch
 * around a state that is fatal anyway.
 *
 * So the absence is pinned rather than trusted. `packages/sense/scripts/probe-write.mjs`
 * prices the alternatives; this refuses the ones that were removed. That a
 * module with no collector still stops the run is next door, in
 * `instrument.test.ts`, where a realm can be built without one.
 */
describe('the emitted probe', () => {
  const code = (): string =>
    instrument('function f(n) { if (n) { return 1; } return 2; }', 'fixture.js')!.code;
  const made = probeSet.probeSet.toString().replace(/\s+/g, ' ');

  it('carries no probe of its own: the first call takes the one the root made for the module', () => {
    // Every module of a realm then runs one function, compiled once, where a
    // probe written into each module is compiled, and warmed, once a module.
    // A circular import can reach a probe before the header runs, so each is a
    // declaration that, on that first call, rebinds itself and the rest.
    expect(code()).toContain('function __va(i){__vaI().va(i)}');
    expect(code()).toContain('function __vaE(){__vaI().E()}');
    expect(code()).not.toContain('__vaS');
  });

  it('answers a hit it has already logged with two byte reads and no call', () => {
    // The flag byte holds which side of evaluation logged it, and the passing
    // byte which side is running now; their `and` is zero only when the region
    // has something left to log.
    expect(made).toMatch(/if \(\(gate\[i\] & passing\[0\]\) === 0\) slow\(i\);/);
  });

  it('asks the scope only where there is one, and appends a new hit inline', () => {
    expect(made).toMatch(/if \(root\.s !== null\) root\.s\(\);/);
    expect(made).toMatch(/root\.L\[n\] = /);
  });

  it('carries no type check and no message', () => {
    for (const text of [code(), made]) {
      expect(text).not.toContain('typeof ');
      expect(text).not.toContain('throw new Error');
      expect(text).not.toMatch(/instrumented for test selection/);
    }
  });
});
