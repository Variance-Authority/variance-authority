/**
 * How Rstest learns which case is running, as source: its registrars wrapped
 * to enter a case scope, and the bracket that attends each attempt.
 *
 * Vitest's runner wraps the test function in `runTask` (`caseRunnerSource` in
 * `worker-source.ts`). Rstest has no runner to replace, so the enclosure comes
 * from the only other thing that holds the function before the runner calls
 * it: the API that registered it. Every registrar is wrapped, its own
 * properties with it, because `it.only`, `it.concurrent` and `it.each(rows)`
 * are each a separate callable that never routes through the bare one.
 */

import { CASE_SCOPE } from './cases.js';
import { scopeGlobalsSource } from './precondition-source.js';

/** The realm key {@link CASE_SCOPE} is, as the generated source has to spell it. */
const CASE_SCOPE_KEY = Symbol.keyFor(CASE_SCOPE) ?? '';

/**
 * The case scope for a runner that has no runner to replace, as source. The
 * coordinate is read at call time, not at registration: `each` interpolates
 * its row into the title and a describe path is assembled only once the suite
 * has collected, and `currentTestName` resolves both.
 *
 * @param holders Source for the objects that hold the registrars, in the order
 * they are wrapped. Defaults to the realm alone, which is every runner whose
 * API is a module rather than an injected object.
 */
export function caseGlobalsSource(holders = 'globalThis'): string {
  return `
const caseScope = globalThis[Symbol.for(${JSON.stringify(CASE_SCOPE_KEY)})];
let caseOrdinal = 0;
// A registrar's properties are registrars too, and \`each\` answers with one
// rather than taking the function itself. Both are followed, to the depth the
// deepest of them nests — \`it.only.each(rows)(name, fn)\`.
const wrapCase = (api, depth) => {
  if (typeof api !== 'function' || depth > 4) return api;
  const out = function (...args) {
    // The body is second, or third behind an options object.
    const at = typeof args[1] === 'function' ? 1 : typeof args[2] === 'function' ? 2 : -1;
    if (at !== -1) {
      const fn = args[at];
      const ordinal = String((caseOrdinal += 1));
      // The describe path it was registered under, from the describe wrap below.
      const path = scopeCurrent;
      args[at] = function (...given) {
        const state = expect.getState();
        // Concurrent cases share the one \`expect\`, which names whichever case
        // set it last; the case's own context names the case, under the path
        // it was registered at.
        const own = given[0]?.task?.name;
        const name = typeof own !== 'string' || state.currentTestName === own ||
          state.currentTestName?.endsWith(' > ' + own) === true
          ? state.currentTestName ?? ''
          : [...path, own].join(' > ');
        // FIXME: the key carries no project, so two Rstest projects' copies of
        // one file are numbered as repeats (\`#1\`) rather than named. The case
        // context names none, and a configuration with \`projects\` gets no setup
        // file of ours to hand one in.
        const key = (state.testPath ?? '') + '\\u0000' + name + '\\u0000' + ordinal;
        // The context the runner hands the body is the one it handed the
        // case's \`beforeEach\`es, so it joins what they said to this case
        // when cases run concurrently.
        return caseScope.enter(key, () => fn.apply(this, given), given[0]);
      };
    }
    const answered = api.apply(this, args);
    return typeof answered === 'function' ? wrapCase(answered, depth + 1) : answered;
  };
  for (const key of Object.keys(api)) out[key] = wrapCase(api[key], depth + 1);
  return out;
};
// \`globals: true\` puts the registrars on the realm. Under Rspack an import of
// \`@rstest/core\` is a read of \`globalThis['@rstest/core']\`, assigned before
// any setup file runs, so wrapping that object in place reaches imported ones.
for (const holder of [${holders}]) {
  if (holder === undefined || holder === null) continue;
  for (const name of ['it', 'test']) {
    if (typeof holder[name] === 'function') holder[name] = wrapCase(holder[name], 0);
  }
}
${scopeGlobalsSource(holders)}`;
}

/**
 * The attending bracket for a runner that has no runner to replace, as source:
 * the counterpart of `onBeforeTryTask` in `caseRunnerSource` in `worker-source.ts`.
 *
 * Rstest calls the root's `beforeEach` hooks at the start of every attempt,
 * retries included, and the setup module registers this one before any of the
 * project's, so a journal opened in the project's `beforeEach` is already
 * attended. The attempt's `onTestFinished` callbacks run once its `afterEach`
 * hooks are done, which is where the bracket closes.
 *
 * @param api Source for the object that holds `beforeEach`.
 */
export function attendingSource(api: string): string {
  return `
{
  const attended = globalThis[Symbol.for(${JSON.stringify(CASE_SCOPE_KEY)})];
  if (typeof attended?.begin === 'function') {
    ${api}.beforeEach((context) => {
      attended.begin();
      context.onTestFinished(() => attended.leave());
    });
  }
}
`;
}
