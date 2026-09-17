import { createContext, runInContext } from 'node:vm';
import { describe, expect, it } from 'vitest';
import { instrument } from './index.js';

/**
 * What an instrumented module says when it runs where no counter factory lives.
 *
 * The state is reachable from a cold install: a Vitest `globalSetup` file sits
 * at the project root, the default include takes it for product source, and it
 * evaluates in the Vitest process — where the setup shim that installs
 * `globalThis.__VA__` is a `setupFiles` entry and has never run. The suite dies
 * before a single test loads, and `globalThis.__VA__ is not a function` names a
 * missing global rather than the situation the reader is in.
 *
 * `vitest.ts` now excludes the declared `globalSetup` paths and `defaultInclude`
 * excludes config files, so the common route here is closed. This is the message
 * for every route that is not — another runner, another seam, a hand-written
 * `include`.
 */
const SENTENCE =
  'eyes.globalSetup.ts was instrumented for test selection, but the counter factory ' +
  'globalThis.__VA__ is not installed in this context. An instrumented module ran outside ' +
  'the test environment the setup shim initialises: a Vitest globalSetup file, a config ' +
  'file, a build script, or a runner this seam does not set up. Narrow the `include` ' +
  'option of withTestSelection so this file is not instrumented.';

describe('an instrumented module with no counter factory', () => {
  it('throws the diagnostic, naming the file and what to do', () => {
    const code = instrument('function setup(n) { return n + 1; }', 'eyes.globalSetup.ts')!.code;

    expect(() => runInContext(code, createContext({}), { filename: 'eyes.globalSetup.ts' }))
      .toThrow(SENTENCE);
  });

  it('is not a bare TypeError about a global', () => {
    const code = instrument('const one = 1;', 'eyes.globalSetup.ts')!.code;
    let thrown: unknown;
    try {
      runInContext(code, createContext({}), { filename: 'eyes.globalSetup.ts' });
    } catch (error) {
      thrown = error;
    }

    expect((thrown as Error).constructor.name).toBe('Error');
    expect((thrown as Error).message).not.toMatch(/__VA__ is not a function/);
  });

  it('keeps the check off the counted path', () => {
    // One `typeof` on the branch that resolves the factory — once per module,
    // and again only where a later test file installed a different one. The
    // per-probe increment is the text it always was.
    const code = instrument('function f(n) { if (n) { return 1; } return 2; }', 'fixture.js')!.code;

    expect(code.match(/typeof r!=='function'/g)).toHaveLength(1);
  });
});
