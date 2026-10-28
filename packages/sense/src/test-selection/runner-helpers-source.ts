/**
 * How the case runner reaches Vitest's runner helpers — a test's function, a
 * suite's hooks, a case's declaration path and a suite's depth — as source,
 * for each Vitest line that hands them out differently.
 */

/**
 * The runner's own helpers on Vitest 2, 3 and 4, from `@vitest/runner` at the
 * path the caller resolved, and the class the runner extends. Vitest 4.1 exports
 * that class from the package root as `TestRunner` and deprecates
 * `vitest/runners`, which prints a line saying so in every worker that imports
 * it; the root's `VitestTestRunner` there is a type and nothing at run time.
 * Vitest 2, 3 and 4.0 export the class only from `vitest/runners`, so that
 * entry is imported only where the root has none. The root is read as a
 * namespace because a named import it lacks fails to link.
 */
function legacyRunner(module: string, utils: string): string {
  return `import { getFn, getHooks } from ${JSON.stringify(module)};
import { getNames } from ${JSON.stringify(utils)};
const VitestTestRunner = vitest.TestRunner ?? (await import('vitest/runners')).VitestTestRunner;
// A case's declaration path under its file.
const testName = (task) => getNames(task).slice(1).join(' > ');`;
}

/**
 * The same, on Vitest 5: the class hands out what `@vitest/runner` did, and a
 * task carries its declaration path as `fullTestName`.
 */
const VITEST_5 = `const VitestTestRunner = vitest.TestRunner;
if (typeof VitestTestRunner?.getTestFn !== 'function' || typeof VitestTestRunner.getSuiteHooks !== 'function') {
  throw new Error('variance-authority: the TestRunner this Vitest exports hands out no getTestFn or getSuiteHooks, and the seam found no runner package beside it');
}
const getFn = (test) => VitestTestRunner.getTestFn(test);
const getHooks = (suite) => VitestTestRunner.getSuiteHooks(suite);
const testName = (task) => task.fullTestName ?? '';`;

/**
 * How many suites a suite sits under, file included, on every line: the suites
 * walked up to the file, counted as `getNames` counts them. A suite with no
 * name is not one, and the file is one whether or not the walk reached it.
 */
const DEPTH = `const depthOf = (suite) => {
  let depth = 0;
  let at = suite;
  while (at?.suite) {
    at = at.suite;
    if (at.name) depth += 1;
  }
  return at === suite.file ? depth : depth + 1;
};`;

/**
 * The helpers on the Vitest the caller resolved: from `@vitest/runner` where
 * `module` and `utils` spell it, and from Vitest 5's `TestRunner` where they
 * are absent. The source expects `vitest` imported as a namespace.
 */
export function runnerHelpersSource(module?: string, utils?: string): string {
  return `${module === undefined || utils === undefined ? VITEST_5 : legacyRunner(module, utils)}
${DEPTH}`;
}
