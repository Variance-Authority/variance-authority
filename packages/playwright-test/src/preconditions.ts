/**
 * Where a `variancePrecondition` call stands in a Playwright worker.
 *
 * The worker runs one test at a time, and `test.info()` names it in the body
 * and in every hook. Which hook is running Playwright knows and does not
 * publish: `_currentHookType` is read, and a worker without it places no call,
 * because a call it cannot tell from a `beforeAll`'s is not guessed to be the
 * body's.
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
      case 'beforeEach':
        // FIXME: the depth of the describe that declared the hook — needs the
        // hook's location; every `beforeEach` of a case reads as its innermost
        // describe's, so one at the top of the file and one inside a describe
        // that say the same name are a contradiction rather than an override.
        return { at: 'beforeEach', key, depth: testOf(info).name.split(' > ').length - 1 };
      case 'afterEach':
        return { at: 'after' };
      default:
        return { at: 'outside', because: `ran in a ${hook}, which runs for no one test` };
    }
  };
}
