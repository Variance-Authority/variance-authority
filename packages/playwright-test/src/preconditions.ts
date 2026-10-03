/**
 * Where a `variancePrecondition` call stands in a Playwright worker.
 *
 * The worker runs one test at a time, and `test.info()` names it in the body
 * and in every hook. Which hook is running Playwright knows and does not
 * publish: `_currentHookType` is read, and a worker without it places no call,
 * because a call it cannot tell from a `beforeAll`'s is not guessed to be the
 * body's.
 *
 * Nor does it publish which `describe` declared a running `beforeEach`. The
 * worker runs a test from the file's suite tree, which its loader keeps per
 * file, and every hook in it carries the location it was declared at. So the
 * test's own `describe`s are read from that tree once, before its hooks run,
 * and the running hook is found among them by its location — the one the
 * worker's timeout slot holds for it.
 */

import { createRequire } from 'node:module';
import { test, type TestInfo } from '@playwright/test';
import type { PreconditionStanding } from '@variance-authority/sense/journal';
import { caseKey, testOf } from './test-coordinate.js';

/** Where Playwright says a function was declared. */
interface Location {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** A `beforeEach` around a test: where it was declared, and how many `describe`s enclose it. */
interface DeclaredHook extends Location {
  readonly depth: number;
}

/** The parts of the loader's suite tree this module reads. */
interface LoadedSuite {
  readonly _type?: string;
  readonly _entries?: readonly (LoadedSuite | LoadedTest)[];
  readonly _hooks?: readonly { readonly type: string; readonly location: Location }[];
  readonly parent?: LoadedSuite;
}

interface LoadedTest {
  readonly parent?: LoadedSuite;
  titlePath(): string[];
}

/** The parts of a worker's `TestInfo` that Playwright keeps to itself. */
interface WorkerTestInfo {
  readonly _requireFile?: unknown;
  readonly _timeoutManager?: { readonly _running?: { readonly runnable?: { readonly location?: Location } } };
  readonly _steps?: readonly WorkerStep[];
}

interface WorkerStep {
  readonly category?: string;
  readonly location?: Location;
  readonly steps?: readonly WorkerStep[];
}

/** The `beforeEach` hooks around the test running in this worker, root to leaf. */
let entered: { readonly testId: string; readonly hooks: readonly DeclaredHook[] } | undefined;

/**
 * Read which `describe` declared each `beforeEach` around a test, before its
 * hooks run, and return what forgets it.
 *
 * A test the loader holds no tree for is entered with nothing, and a call from
 * its `beforeEach` is then placed on no case rather than at a guessed level.
 */
export async function enterDescribes(testInfo: TestInfo): Promise<() => void> {
  const hooks = await declaredHooks(testInfo);
  const mine = hooks === undefined ? undefined : { testId: testInfo.testId, hooks };
  entered = mine;
  return () => {
    if (entered === mine) entered = undefined;
  };
}

/**
 * Where a call stands, asked at the moment it is made.
 *
 * @param owner The file a test's case is filed under, as the recorder spells it.
 */
export function playwrightStanding(owner: (testInfo: TestInfo) => string): () => PreconditionStanding {
  return () => {
    let info: TestInfo;
    try {
      info = test.info();
    } catch {
      return { at: 'outside', because: 'ran outside a running test' };
    }
    const hookType = (info as { _currentHookType?: unknown })._currentHookType;
    if (typeof hookType !== 'function') {
      return { at: 'outside', because: 'ran in a Playwright worker that does not say which hook is running' };
    }
    const key = caseKey(owner(info), testOf(info).id);
    const hook = (hookType as () => string | undefined).call(info);
    switch (hook) {
      case undefined:
        return { at: 'case', key };
      case 'beforeEach': {
        const depth = runningDepth(info);
        if (depth === undefined) {
          return { at: 'outside', because: 'ran in a beforeEach whose describe this Playwright worker does not say' };
        }
        return { at: 'beforeEach', key, depth };
      }
      case 'afterEach':
        return { at: 'after' };
      default:
        return { at: 'outside', because: `ran in a ${hook}, which runs for no one test` };
    }
  };
}

/**
 * How many `describe`s enclose the `beforeEach` running now.
 *
 * One line can declare a hook at two depths of one test, when a helper that
 * calls `test.beforeEach` is called in a `describe` and again in one inside
 * it. Playwright runs those root to leaf, and opens a step for each at its
 * location, so the steps already opened at that location say which of them is
 * running.
 */
function runningDepth(info: TestInfo): number | undefined {
  if (entered === undefined || entered.testId !== info.testId) return undefined;
  const worker = info as unknown as WorkerTestInfo;
  const location = worker._timeoutManager?._running?.runnable?.location;
  if (location === undefined) return undefined;
  const candidates = entered.hooks.filter((hook) => at(hook, location));
  if (candidates.length <= 1) return candidates[0]?.depth;
  const opened = hookSteps(worker._steps ?? [], location);
  return candidates[opened - 1]?.depth;
}

function hookSteps(steps: readonly WorkerStep[], location: Location): number {
  let count = 0;
  for (const step of steps) {
    if (step.category === 'hook' && step.location !== undefined && at(step.location, location)) count += 1;
    count += hookSteps(step.steps ?? [], location);
  }
  return count;
}

function at(one: Location, other: Location): boolean {
  return one.file === other.file && one.line === other.line && one.column === other.column;
}

/**
 * The `beforeEach` hooks around one test, root to leaf, each with its depth:
 * `0` at the top of the file, one deeper for each `describe` around it.
 *
 * The worker loaded the test's file before running it, so the loader answers
 * from its cache; a file it does not hold is not loaded here.
 */
async function declaredHooks(testInfo: TestInfo): Promise<readonly DeclaredHook[] | undefined> {
  const file = (testInfo as unknown as WorkerTestInfo)._requireFile;
  if (typeof file !== 'string') return undefined;
  let root: LoadedSuite;
  try {
    root = await loadTestFile()(file);
  } catch {
    return undefined;
  }
  const matching = testsOf(root).filter((candidate) => {
    const path = candidate.titlePath();
    const tail = testInfo.titlePath.slice(-path.length);
    return tail.length === path.length && tail.every((title, index) => title === path[index]);
  });
  if (matching.length !== 1) return undefined;
  const suites: LoadedSuite[] = [];
  for (let suite = matching[0]!.parent; suite !== undefined; suite = suite.parent) suites.unshift(suite);
  const hooks: DeclaredHook[] = [];
  let depth = 0;
  for (const suite of suites) {
    if (suite._type === 'describe') depth += 1;
    for (const hook of suite._hooks ?? []) {
      if (hook.type === 'beforeEach') hooks.push({ ...hook.location, depth });
    }
  }
  return hooks;
}

function testsOf(suite: LoadedSuite): LoadedTest[] {
  return (suite._entries ?? []).flatMap((entry) =>
    '_entries' in entry ? testsOf(entry as LoadedSuite) : [entry as LoadedTest],
  );
}

/**
 * The worker's own test loader, resolved through `@playwright/test` so it is
 * the copy the worker loaded the file with, and its cache is the one read.
 */
function loadTestFile(): (file: string) => Promise<LoadedSuite> {
  const fromTest = createRequire(createRequire(import.meta.url).resolve('@playwright/test'));
  const common = fromTest('playwright/lib/common') as {
    testLoader?: { loadTestFile?: (file: string) => Promise<LoadedSuite> };
  };
  const load = common.testLoader?.loadTestFile;
  if (load === undefined) throw new Error('this Playwright has no test loader');
  return load;
}
