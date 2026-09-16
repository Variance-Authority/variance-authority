import { describe, expect, it } from 'vitest';
import {
  ALL_ENGINES,
  DECLARED_ENGINES,
  declaredEngines,
  engineStatus,
  installCommand,
  requireEngines,
} from './engines.js';

/**
 * What this machine has, and what that is allowed to change.
 *
 * `engines.chromium.test.ts` next door needs browsers, which is the wrong place
 * for these claims: they are about the *decision* a run makes before any browser
 * is launched, and the dangerous case — a laptop with some engines and not all —
 * is one that a machine with every engine installed can never demonstrate.
 *
 * So nothing here asserts which engines are present. Every claim is a property
 * that must hold on a laptop with all of them, a laptop with one, and CI with
 * none, because a check that only holds on the author's machine is the exact
 * failure this module was written to end.
 */

describe('which engines a run is asked to use', () => {
  it('declares the list rather than discovering it', () => {
    // The inversion this file exists for. `DECLARED_ENGINES` is in the
    // repository where a diff can see it; nothing consults the filesystem to
    // decide what a run is *for*.
    expect(declaredEngines({})).toEqual(DECLARED_ENGINES);
    expect(declaredEngines({ VARIANCE_ENGINES: 'webkit, chromium' })).toEqual([
      'webkit',
      'chromium',
    ]);
    expect(() => declaredEngines({ VARIANCE_ENGINES: 'blink' })).toThrow(/known engines are/);
    expect(() => declaredEngines({ VARIANCE_ENGINES: ' , ' })).toThrow(/names no engine/);
  });

  it('accounts for every declared engine exactly once', () => {
    // The partition is the whole contract: an engine that appeared in neither
    // list would be one nobody checked, which is the state that used to pass.
    const status = engineStatus(ALL_ENGINES);

    expect([...status.present, ...status.missing].sort()).toEqual([...ALL_ENGINES].sort());
    expect(status.present.filter((name) => status.missing.includes(name))).toEqual([]);
    expect(engineStatus([])).toEqual({ present: [], missing: [] });
  });

  it('is all or nothing, and names what is missing when it is neither', () => {
    // Three outcomes, and which one this machine produces is not the claim —
    // that every one of them follows from the same reading is. A machine with
    // *some* declared engines is the dangerous state: under the discovery this
    // replaced it measured what it had and reported green.
    const declared = declaredEngines();
    const { present, missing } = engineStatus(declared);

    if (missing.length === 0) {
      expect(requireEngines(declared)).toEqual(declared);
      return;
    }

    if (present.length === 0) {
      // CI on purpose: it installs no browser, and its callers skip and say so.
      expect(requireEngines(declared)).toEqual([]);
      return;
    }

    expect(() => requireEngines(declared)).toThrow(installCommand(missing));
    for (const name of missing) expect(() => requireEngines(declared)).toThrow(name);
  });

  it('says how to install what is absent, in the form a reader can paste', () => {
    expect(installCommand(['webkit', 'firefox'])).toBe('npx playwright install webkit firefox');
  });
});
