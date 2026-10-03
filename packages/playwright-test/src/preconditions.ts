/**
 * Where a `variancePrecondition` call stands in a Playwright worker.
 *
 * The worker runs one test at a time, and `test.info()` names it in the body
 * and in every hook. Which hook is running Playwright knows and does not
 * publish: `_currentHookType` is read. A recording worker without it fails at
 * setup, in `enterDescribes`; anywhere else a call it cannot tell from a
 * `beforeAll`'s is placed on no case, not guessed to be the body's.
 *
 * Nor does it publish which `describe` declared a running `beforeEach`. The
 * worker runs a test from a clone of the file's suite tree, which its loader
 * keeps per file, and a clone shares its hooks with the tree it was made from.
 * So each `beforeEach`'s depth is read from that tree once per file, before a
 * test's hooks run, keyed by the location object Playwright made when the hook
 * was declared; the running hook is the one whose location object the worker's
 * timeout slot holds.
 */

import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { test, type TestInfo } from '@playwright/test';
import type { PreconditionStanding } from '@variance-authority/sense/journal';
import { caseKey, testOf } from './test-coordinate.js';

/** Where Playwright says a function was declared: one object per declaration. */
interface Location {
  readonly file: string;
  readonly line: number;
  readonly column: number;
}

/** The parts of the loader's suite tree this module reads. */
interface LoadedSuite {
  readonly _type?: unknown;
  readonly _entries?: unknown;
  readonly _hooks?: unknown;
}

interface LoadedHook {
  readonly type: string;
  readonly location: Location;
}

/** The parts of a worker's `TestInfo` that Playwright keeps to itself. */
interface WorkerTestInfo {
  readonly _currentHookType?: unknown;
  readonly _requireFile?: unknown;
  readonly _timeoutManager?: { readonly _running?: { readonly runnable?: { readonly location?: Location } } };
}

/** How many `describe`s enclose each `beforeEach` read so far, by its declared location. */
const depths = new WeakMap<Location, number>();

/** The test files whose `beforeEach`s are in `depths`. */
const read = new Set<string>();

/** Why this worker cannot say a hook's `describe`, once found. */
let unread: Error | undefined;

/**
 * Read which `describe` declared each `beforeEach` in a test's file, before
 * its hooks run.
 *
 * Every read here is of something Playwright keeps to itself. When one is
 * missing this throws, in the worker, naming that internal and the installed
 * Playwright, and throws the same for every test after: a worker that cannot
 * say a hook's `describe` fails at setup, not at the first precondition a hook
 * happens to say.
 */
export async function enterDescribes(testInfo: TestInfo): Promise<void> {
  if (unread !== undefined) throw unread;
  try {
    await readDescribes(testInfo as unknown as WorkerTestInfo);
  } catch (error) {
    unread = error as Error;
    throw unread;
  }
}

async function readDescribes(worker: WorkerTestInfo): Promise<void> {
  if (typeof worker._currentHookType !== 'function') throw missing('TestInfo._currentHookType()');
  if (worker._timeoutManager?._running?.runnable === undefined) {
    throw missing('TestInfo._timeoutManager._running.runnable');
  }
  const file = worker._requireFile;
  if (typeof file !== 'string') throw missing('TestInfo._requireFile');
  if (read.has(file)) return;
  let root: LoadedSuite;
  try {
    // A file the loader has cached comes back from the cache. It is called
    // without the config a first load needs, so a file it does not hold — a
    // second copy of Playwright, with a cache of its own — rejects before
    // anything is loaded, as does a Playwright whose loader is elsewhere.
    root = await loadTestFile()(file);
  } catch {
    throw missing(`suite tree cached for ${file} in the testLoader its worker used`);
  }
  readSuite(root, 0);
  read.add(file);
}

function readSuite(suite: LoadedSuite, enclosing: number): void {
  if (typeof suite._type !== 'string') throw missing('Suite._type');
  if (!Array.isArray(suite._hooks)) throw missing('Suite._hooks');
  if (!Array.isArray(suite._entries)) throw missing('Suite._entries');
  const depth = suite._type === 'describe' ? enclosing + 1 : enclosing;
  for (const hook of suite._hooks as readonly LoadedHook[]) {
    if (hook.type === 'beforeEach') depths.set(hook.location, depth);
  }
  for (const entry of suite._entries as readonly LoadedSuite[]) {
    if ('_entries' in entry) readSuite(entry, depth);
  }
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
    const worker = info as unknown as WorkerTestInfo;
    const hookType = worker._currentHookType;
    if (typeof hookType !== 'function') {
      return { at: 'outside', because: 'ran in a Playwright worker that does not say which hook is running' };
    }
    const key = caseKey(owner(info), testOf(info).id);
    const hook = (hookType as () => string | undefined).call(info);
    switch (hook) {
      case undefined:
        return { at: 'case', key };
      case 'beforeEach': {
        const location = worker._timeoutManager?._running?.runnable?.location;
        const depth = location === undefined ? undefined : depths.get(location);
        if (depth === undefined) {
          return {
            at: 'outside',
            because: `ran in a beforeEach whose describe Playwright ${playwrightVersion()} did not say; say it in the test body`,
          };
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

/** Playwright as the worker loaded it, resolved through `@playwright/test`. */
function fromPlaywright(): NodeJS.Require {
  return createRequire(createRequire(import.meta.url).resolve('@playwright/test'));
}

/**
 * The worker's own test loader, resolved through `@playwright/test` so it
 * reads the loader instance the worker used, and its cached suite tree.
 *
 * Playwright 1.62 and 1.63 bundle it into `lib/common/index.js`; 1.58 and 1.59
 * keep it in `lib/common/testLoader.js`, which no export names and the worker
 * requires by that path. Either is reached by file path from the installed
 * package, so the module instance is the one the worker required.
 */
function loadTestFile(): (file: string) => Promise<LoadedSuite> {
  const root = dirname(fromPlaywright().resolve('playwright/package.json'));
  const separate = join(root, 'lib/common/testLoader.js');
  if (existsSync(separate)) {
    return (fromPlaywright()(separate) as { loadTestFile: (file: string) => Promise<LoadedSuite> }).loadTestFile;
  }
  const bundled = fromPlaywright()(join(root, 'lib/common/index.js')) as {
    testLoader: { loadTestFile: (file: string) => Promise<LoadedSuite> };
  };
  return bundled.testLoader.loadTestFile;
}

/** The installed Playwright's version, as its package says it. */
export function playwrightVersion(): string {
  return (fromPlaywright()('playwright/package.json') as { version: string }).version;
}

function missing(internal: string): Error {
  return new Error(
    `variancePrecondition cannot say which describe declared a beforeEach: Playwright ${playwrightVersion()} has no ${internal}`,
  );
}
