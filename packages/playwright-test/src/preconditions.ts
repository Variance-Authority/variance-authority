/**
 * Where a `variancePrecondition` call stands in a Playwright worker.
 *
 * The worker runs one test at a time, and `test.info()` names it in the body
 * and in every hook. Which hook is running Playwright knows and does not
 * publish: `_currentHookType` is read where it exists, and a worker without it
 * reads every call as the body's.
 */

import { test, type TestInfo } from '@playwright/test';
import type { PreconditionStanding } from '@variance-authority/sense/journal';
import { caseKey, testOf } from './test-coordinate.js';

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
      return { at: 'unplaced', because: 'ran outside a test and its hooks' };
    }
    const key = caseKey(owner(info), testOf(info).id);
    const hook = (info as { _currentHookType?: () => string | undefined })._currentHookType?.();
    switch (hook) {
      case undefined:
        return { at: 'case', key };
      case 'beforeEach':
        // FIXME: the depth of the describe that declared the hook — needs the
        // hook's location; every `beforeEach` of a case reads as its innermost
        // describe's, so a file-level and a describe-level one that say the
        // same name are a contradiction rather than an override.
        return { at: 'beforeEach', key, depth: testOf(info).name.split(' > ').length - 1 };
      case 'beforeAll':
        // FIXME: the cases a `beforeAll` reaches — needs the describe it was
        // declared in, which `test.info()` in the hook does not name.
        return { at: 'unplaced', because: 'ran in a Playwright beforeAll, whose cases the worker cannot name,' };
      default:
        return { at: 'after' };
    }
  };
}
